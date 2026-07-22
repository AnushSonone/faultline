use arrow::record_batch::RecordBatch;
use faultline_ingest::SignalKind;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct RuntimeBatch {
    pub signal: SignalKind,
    pub batch: RecordBatch,
    pub watermark_ns: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlMessage {
    Pause,
    Reset,
    Seek { event_time_ns: i64 },
    Barrier { name: String },
    Cancel,
    EndOfSource,
}

#[derive(Clone, Debug)]
pub enum RuntimeMessage {
    Batch(RuntimeBatch),
    Watermark { watermark_ns: i64 },
    Control(ControlMessage),
}
