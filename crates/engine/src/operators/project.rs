use std::sync::Arc;

use arrow::array::{ArrayRef, Float64Array};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics};

#[derive(Clone, Debug)]
pub enum ProjectExpr {
    Column(String),
    Alias { name: String, from: String },
    /// value * scale (simple derived numeric).
    Scale { name: String, from: String, scale: f64 },
}

pub struct ProjectionExec {
    id: String,
    exprs: Vec<ProjectExpr>,
    metrics: OperatorMetrics,
}

impl ProjectionExec {
    pub fn new(id: impl Into<String>, exprs: Vec<ProjectExpr>) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            exprs,
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
        }
    }
}

impl Operator for ProjectionExec {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.batches_in += 1;
        self.metrics.rows_in += batch.batch.num_rows() as u64;
        let mut fields = Vec::new();
        let mut cols: Vec<ArrayRef> = Vec::new();
        for expr in &self.exprs {
            match expr {
                ProjectExpr::Column(name) | ProjectExpr::Alias { from: name, .. } => {
                    let col = batch
                        .batch
                        .column_by_name(name)
                        .ok_or_else(|| OperatorError::Message(format!("missing {name}")))?
                        .clone();
                    let out_name = match expr {
                        ProjectExpr::Alias { name, .. } => name.clone(),
                        ProjectExpr::Column(n) => n.clone(),
                        _ => unreachable!(),
                    };
                    fields.push(Field::new(
                        out_name,
                        col.data_type().clone(),
                        col.is_nullable(),
                    ));
                    cols.push(col);
                }
                ProjectExpr::Scale { name, from, scale } => {
                    let col = batch
                        .batch
                        .column_by_name(from)
                        .ok_or_else(|| OperatorError::Message(format!("missing {from}")))?;
                    let arr = col
                        .as_any()
                        .downcast_ref::<Float64Array>()
                        .ok_or_else(|| OperatorError::Message("scale needs f64".into()))?;
                    let scaled: Float64Array = arr.iter().map(|v| v.map(|x| x * scale)).collect();
                    fields.push(Field::new(name, DataType::Float64, true));
                    cols.push(Arc::new(scaled));
                }
            }
        }
        // Always keep event_time_ns + service when present for downstream windows.
        for keep in ["event_time_ns", "service", "ingest_sequence"] {
            if self.exprs.iter().any(|e| match e {
                ProjectExpr::Column(n) => n == keep,
                ProjectExpr::Alias { name, .. } => name == keep,
                ProjectExpr::Scale { name, .. } => name == keep,
            }) {
                continue;
            }
            if let Some(col) = batch.batch.column_by_name(keep) {
                fields.push(Field::new(keep, col.data_type().clone(), col.is_nullable()));
                cols.push(col.clone());
            }
        }
        let schema = Arc::new(Schema::new(fields));
        let out = RecordBatch::try_new(schema, cols)
            .map_err(|e| OperatorError::Message(e.to_string()))?;
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
