use std::sync::Arc;

use arrow::array::{
    Array, Float64Array, Float64Builder, Int64Builder, StringArray, StringBuilder,
};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use indexmap::IndexMap;

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AggFn {
    Count,
    Sum,
    Min,
    Max,
    Avg,
}

#[derive(Clone, Debug, Default)]
struct AggState {
    count: u64,
    sum: f64,
    min: f64,
    max: f64,
    seen: bool,
}

impl AggState {
    fn update(&mut self, v: f64) {
        if !self.seen {
            self.min = v;
            self.max = v;
            self.seen = true;
        } else {
            self.min = self.min.min(v);
            self.max = self.max.max(v);
        }
        self.count += 1;
        self.sum += v;
    }

    fn value(&self, fun: AggFn) -> f64 {
        match fun {
            AggFn::Count => self.count as f64,
            AggFn::Sum => self.sum,
            AggFn::Min => {
                if self.seen {
                    self.min
                } else {
                    0.0
                }
            }
            AggFn::Max => {
                if self.seen {
                    self.max
                } else {
                    0.0
                }
            }
            AggFn::Avg => {
                if self.count == 0 {
                    0.0
                } else {
                    self.sum / self.count as f64
                }
            }
        }
    }
}

/// Hash aggregate. Null values in `value` are skipped (documented).
/// Output rows are sorted by group key for stable tests.
pub struct HashAggregateExec {
    id: String,
    group_cols: Vec<String>,
    value_col: String,
    fun: AggFn,
    /// Optional fixed window key column already present on rows.
    window_key_col: Option<String>,
    groups: IndexMap<String, AggState>,
    metrics: OperatorMetrics,
    emit_on_batch: bool,
}

impl HashAggregateExec {
    pub fn new(
        id: impl Into<String>,
        group_cols: Vec<String>,
        value_col: impl Into<String>,
        fun: AggFn,
    ) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            group_cols,
            value_col: value_col.into(),
            fun,
            window_key_col: None,
            groups: IndexMap::new(),
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
            emit_on_batch: true,
        }
    }

    pub fn with_window_key(mut self, col: impl Into<String>) -> Self {
        self.window_key_col = Some(col.into());
        self
    }

    pub fn accumulate_only(mut self) -> Self {
        self.emit_on_batch = false;
        self
    }

    fn group_key(&self, batch: &RecordBatch, row: usize) -> Result<String, OperatorError> {
        let mut parts = Vec::new();
        if let Some(wk) = &self.window_key_col {
            let col = batch
                .column_by_name(wk)
                .ok_or_else(|| OperatorError::Message(format!("missing {wk}")))?;
            let s = col
                .as_any()
                .downcast_ref::<StringArray>()
                .ok_or_else(|| OperatorError::Message("window key utf8".into()))?;
            parts.push(if s.is_null(row) {
                "".into()
            } else {
                s.value(row).to_owned()
            });
        }
        for name in &self.group_cols {
            let col = batch
                .column_by_name(name)
                .ok_or_else(|| OperatorError::Message(format!("missing {name}")))?;
            let s = col
                .as_any()
                .downcast_ref::<StringArray>()
                .ok_or_else(|| OperatorError::Message(format!("{name} utf8").into()))?;
            parts.push(if s.is_null(row) {
                "".into()
            } else {
                s.value(row).to_owned()
            });
        }
        Ok(parts.join("|"))
    }

    fn emit_batch(&self) -> Result<RecordBatch, OperatorError> {
        let mut keys = StringBuilder::new();
        let mut values = Float64Builder::new();
        let mut counts = Int64Builder::new();
        let mut pairs: Vec<_> = self.groups.iter().collect();
        pairs.sort_by(|a, b| a.0.cmp(b.0));
        for (k, st) in pairs {
            if st.count == 0 {
                continue;
            }
            keys.append_value(k);
            values.append_value(st.value(self.fun));
            counts.append_value(st.count as i64);
        }
        RecordBatch::try_new(
            Arc::new(Schema::new(vec![
                Field::new("group_key", DataType::Utf8, false),
                Field::new("value", DataType::Float64, false),
                Field::new("count", DataType::Int64, false),
            ])),
            vec![
                Arc::new(keys.finish()),
                Arc::new(values.finish()),
                Arc::new(counts.finish()),
            ],
        )
        .map_err(|e| OperatorError::Message(e.to_string()))
    }
}

impl Operator for HashAggregateExec {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.batches_in += 1;
        self.metrics.rows_in += batch.batch.num_rows() as u64;
        let values = batch
            .batch
            .column_by_name(&self.value_col)
            .ok_or_else(|| OperatorError::Message("missing value col".into()))?
            .as_any()
            .downcast_ref::<Float64Array>()
            .ok_or_else(|| OperatorError::Message("value f64".into()))?;
        for i in 0..batch.batch.num_rows() {
            if values.is_null(i) {
                continue;
            }
            let key = self.group_key(&batch.batch, i)?;
            self.groups.entry(key).or_default().update(values.value(i));
        }
        if !self.emit_on_batch {
            return Ok(Vec::new());
        }
        let out = self.emit_batch()?;
        self.metrics.batches_out += 1;
        self.metrics.rows_out += out.num_rows() as u64;
        Ok(vec![RuntimeBatch {
            signal: batch.signal,
            batch: out,
            watermark_ns: batch.watermark_ns,
        }])
    }

    fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.current_watermark_ns = watermark_ns;
        Ok(Vec::new())
    }

    fn on_control(&mut self, ctrl: &ControlMessage) -> Result<Vec<RuntimeBatch>, OperatorError> {
        if matches!(ctrl, ControlMessage::Reset | ControlMessage::Seek { .. }) {
            self.groups.clear();
            self.metrics = OperatorMetrics {
                operator_id: self.id.clone(),
                ..Default::default()
            };
        }
        Ok(Vec::new())
    }

    fn metrics(&self) -> OperatorMetrics {
        let mut m = self.metrics.clone();
        m.state_bytes = self.groups.len() * 64;
        m
    }
}
