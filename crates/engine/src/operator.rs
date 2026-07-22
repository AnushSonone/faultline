//! Operator contract for the bounded runtime (TA-023).

use arrow::record_batch::RecordBatch;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::message::{ControlMessage, RuntimeBatch};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OperatorSnapshot {
    pub operator_id: String,
    pub watermark_ns: i64,
    pub state_bytes: usize,
    pub blob: Vec<u8>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OperatorMetrics {
    pub operator_id: String,
    pub rows_in: u64,
    pub rows_out: u64,
    pub batches_in: u64,
    pub batches_out: u64,
    pub processing_duration_ns: u64,
    pub queue_wait_duration_ns: u64,
    pub queue_depth: usize,
    pub channel_capacity: usize,
    pub state_bytes: usize,
    pub current_watermark_ns: i64,
    pub late_events: u64,
    pub errors: u64,
    pub last_activity_ns: i64,
}

#[derive(Debug, Error)]
pub enum OperatorError {
    #[error("{0}")]
    Message(String),
}

pub trait Operator: Send {
    fn id(&self) -> &str;
    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError>;
    fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError>;
    fn on_control(&mut self, _ctrl: &ControlMessage) -> Result<Vec<RuntimeBatch>, OperatorError> {
        Ok(Vec::new())
    }
    fn snapshot(&self) -> OperatorSnapshot {
        OperatorSnapshot {
            operator_id: self.id().to_owned(),
            watermark_ns: 0,
            state_bytes: 0,
            blob: Vec::new(),
        }
    }
    fn restore(&mut self, _snapshot: OperatorSnapshot) -> Result<(), OperatorError> {
        Ok(())
    }
    fn metrics(&self) -> OperatorMetrics;
}

/// Helper to wrap a plain RecordBatch as a runtime batch.
pub fn batch_from_record(signal: faultline_ingest::SignalKind, batch: RecordBatch) -> RuntimeBatch {
    RuntimeBatch {
        signal,
        batch,
        watermark_ns: None,
    }
}
