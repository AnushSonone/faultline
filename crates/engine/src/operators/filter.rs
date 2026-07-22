use arrow::array::{Array, Float64Array, StringArray};
use arrow_select::filter::filter_record_batch;

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics};

#[derive(Clone, Debug)]
pub enum Predicate {
    ServiceEq(String),
    NameContains(String),
    ValueGt(f64),
    ValueLt(f64),
    And(Box<Predicate>, Box<Predicate>),
    Or(Box<Predicate>, Box<Predicate>),
}

pub struct FilterExec {
    id: String,
    predicate: Predicate,
    metrics: OperatorMetrics,
}

impl FilterExec {
    pub fn new(id: impl Into<String>, predicate: Predicate) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            predicate,
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
        }
    }
}

impl Operator for FilterExec {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.batches_in += 1;
        self.metrics.rows_in += batch.batch.num_rows() as u64;
        let mask = eval_predicate(&self.predicate, &batch.batch)?;
        let filtered = filter_record_batch(&batch.batch, &mask)
            .map_err(|e| OperatorError::Message(e.to_string()))?;
        self.metrics.batches_out += 1;
        self.metrics.rows_out += filtered.num_rows() as u64;
        Ok(vec![RuntimeBatch {
            signal: batch.signal,
            batch: filtered,
            watermark_ns: batch.watermark_ns,
        }])
    }

    fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.current_watermark_ns = watermark_ns;
        Ok(Vec::new())
    }

    fn on_control(&mut self, ctrl: &ControlMessage) -> Result<Vec<RuntimeBatch>, OperatorError> {
        if matches!(ctrl, ControlMessage::Reset) {
            self.metrics = OperatorMetrics {
                operator_id: self.id.clone(),
                ..Default::default()
            };
        }
        Ok(Vec::new())
    }

    fn metrics(&self) -> OperatorMetrics {
        self.metrics.clone()
    }
}

fn eval_predicate(
    pred: &Predicate,
    batch: &arrow::record_batch::RecordBatch,
) -> Result<arrow::array::BooleanArray, OperatorError> {
    use arrow::array::BooleanArray;
    match pred {
        Predicate::And(a, b) => {
            let left = eval_predicate(a, batch)?;
            let right = eval_predicate(b, batch)?;
            let mut out = Vec::with_capacity(batch.num_rows());
            for i in 0..batch.num_rows() {
                out.push(left.value(i) && right.value(i));
            }
            Ok(BooleanArray::from(out))
        }
        Predicate::Or(a, b) => {
            let left = eval_predicate(a, batch)?;
            let right = eval_predicate(b, batch)?;
            let mut out = Vec::with_capacity(batch.num_rows());
            for i in 0..batch.num_rows() {
                out.push(left.value(i) || right.value(i));
            }
            Ok(BooleanArray::from(out))
        }
        Predicate::ServiceEq(svc) => {
            let col = batch
                .column_by_name("service")
                .ok_or_else(|| OperatorError::Message("missing service".into()))?;
            let arr = col
                .as_any()
                .downcast_ref::<StringArray>()
                .ok_or_else(|| OperatorError::Message("service not utf8".into()))?;
            Ok(BooleanArray::from(
                (0..arr.len())
                    .map(|i| !arr.is_null(i) && arr.value(i) == svc)
                    .collect::<Vec<_>>(),
            ))
        }
        Predicate::NameContains(substr) => {
            let col = batch
                .column_by_name("name")
                .ok_or_else(|| OperatorError::Message("missing name".into()))?;
            let arr = col
                .as_any()
                .downcast_ref::<StringArray>()
                .ok_or_else(|| OperatorError::Message("name not utf8".into()))?;
            Ok(BooleanArray::from(
                (0..arr.len())
                    .map(|i| !arr.is_null(i) && arr.value(i).contains(substr))
                    .collect::<Vec<_>>(),
            ))
        }
        Predicate::ValueGt(thr) => cmp_value(batch, |v| v > *thr),
        Predicate::ValueLt(thr) => cmp_value(batch, |v| v < *thr),
    }
}

fn cmp_value(
    batch: &arrow::record_batch::RecordBatch,
    f: impl Fn(f64) -> bool,
) -> Result<arrow::array::BooleanArray, OperatorError> {
    let col = batch
        .column_by_name("value")
        .ok_or_else(|| OperatorError::Message("missing value".into()))?;
    let arr = col
        .as_any()
        .downcast_ref::<Float64Array>()
        .ok_or_else(|| OperatorError::Message("value not f64".into()))?;
    Ok(arrow::array::BooleanArray::from(
        (0..arr.len())
            .map(|i| !arr.is_null(i) && f(arr.value(i)))
            .collect::<Vec<_>>(),
    ))
}
