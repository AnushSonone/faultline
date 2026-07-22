//! Bounded operator runtime with control priority (TA-023).

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::mpsc;

use crate::message::{ControlMessage, RuntimeBatch, RuntimeMessage};
use crate::operator::{Operator, OperatorError, OperatorMetrics};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeInspectorDto {
    pub global_watermark_ns: i64,
    pub allowed_lateness_ns: i64,
    pub late_events: u64,
    pub beyond_grace_events: u64,
    pub reorder_buffer_size: usize,
    pub operators: Vec<OperatorMetrics>,
    pub rows_processed: u64,
    pub batches_processed: u64,
    pub queue_depth: usize,
    pub active_window_count: usize,
    pub finalized_window_count: usize,
    pub heatmap_revisions: u64,
    pub projection_mode: String,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Operator(#[from] OperatorError),
    #[error("channel full at edge {0}")]
    ChannelFull(String),
    #[error("runtime cancelled")]
    Cancelled,
    #[error("{0}")]
    Message(String),
}

/// Synchronous bounded pipeline for deterministic tests and session integration.
pub struct SyncRuntime {
    operators: Vec<Box<dyn Operator>>,
    capacities: Vec<usize>,
    cancelled: bool,
    last_error: Option<String>,
    global_watermark_ns: i64,
}

impl SyncRuntime {
    pub fn new(operators: Vec<Box<dyn Operator>>, edge_capacity: usize) -> Self {
        let n = operators.len().saturating_sub(1);
        Self {
            operators,
            capacities: vec![edge_capacity.max(1); n],
            cancelled: false,
            last_error: None,
            global_watermark_ns: i64::MIN,
        }
    }

    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    pub fn metrics(&self) -> Vec<OperatorMetrics> {
        self.operators.iter().map(|o| o.metrics()).collect()
    }

    pub fn reset(&mut self) {
        self.cancelled = false;
        self.last_error = None;
        self.global_watermark_ns = i64::MIN;
        for op in &mut self.operators {
            let _ = op.on_control(&ControlMessage::Reset);
        }
    }

    pub fn push_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, RuntimeError> {
        self.drive(RuntimeMessage::Batch(batch))
    }

    pub fn push_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, RuntimeError> {
        if watermark_ns > self.global_watermark_ns {
            self.global_watermark_ns = watermark_ns;
        }
        self.drive(RuntimeMessage::Watermark { watermark_ns })
    }

    pub fn push_control(
        &mut self,
        ctrl: ControlMessage,
    ) -> Result<Vec<RuntimeBatch>, RuntimeError> {
        let is_cancel = matches!(ctrl, ControlMessage::Cancel);
        let out = self.drive(RuntimeMessage::Control(ctrl))?;
        if is_cancel {
            self.cancelled = true;
        }
        Ok(out)
    }

    fn drive(&mut self, msg: RuntimeMessage) -> Result<Vec<RuntimeBatch>, RuntimeError> {
        if self.cancelled {
            return Err(RuntimeError::Cancelled);
        }
        let mut frontier: VecDeque<(usize, RuntimeMessage)> = VecDeque::new();
        // Control messages are pushed to the front of the frontier (priority).
        match msg {
            RuntimeMessage::Control(c) => frontier.push_front((0, RuntimeMessage::Control(c))),
            other => frontier.push_back((0, other)),
        }

        let mut sink_out = Vec::new();
        let n_ops = self.operators.len();
        while let Some((idx, message)) = frontier.pop_front() {
            if idx >= n_ops {
                continue;
            }
            let op_id = self.operators[idx].id().to_owned();
            let produced = match message {
                RuntimeMessage::Batch(b) => self.operators[idx].on_batch(b),
                RuntimeMessage::Watermark { watermark_ns } => {
                    self.operators[idx].on_watermark(watermark_ns)
                }
                RuntimeMessage::Control(c) => self.operators[idx].on_control(&c),
            };
            let produced = match produced {
                Ok(p) => p,
                Err(e) => {
                    self.last_error = Some(e.to_string());
                    return Err(RuntimeError::Operator(e));
                }
            };
            if idx + 1 >= n_ops {
                sink_out.extend(produced);
            } else {
                let cap = self.capacities[idx];
                if produced.len() > cap {
                    return Err(RuntimeError::ChannelFull(op_id));
                }
                for b in produced {
                    frontier.push_back((idx + 1, RuntimeMessage::Batch(b)));
                }
            }
        }
        Ok(sink_out)
    }

    /// Push watermark through every operator and collect terminal batches.
    pub fn broadcast_watermark(
        &mut self,
        watermark_ns: i64,
    ) -> Result<Vec<RuntimeBatch>, RuntimeError> {
        if watermark_ns > self.global_watermark_ns {
            self.global_watermark_ns = watermark_ns;
        }
        let n = self.operators.len();
        if n == 0 {
            return Ok(Vec::new());
        }
        let mut msgs = vec![RuntimeMessage::Watermark { watermark_ns }];
        let mut terminal = Vec::new();
        for i in 0..n {
            let mut next = Vec::new();
            for m in std::mem::take(&mut msgs) {
                let batches = match m {
                    RuntimeMessage::Batch(b) => self.operators[i].on_batch(b)?,
                    RuntimeMessage::Watermark { watermark_ns } => {
                        self.operators[i].on_watermark(watermark_ns)?
                    }
                    RuntimeMessage::Control(c) => self.operators[i].on_control(&c)?,
                };
                if i + 1 == n {
                    terminal.extend(batches);
                } else {
                    for b in batches {
                        next.push(RuntimeMessage::Batch(b));
                    }
                }
            }
            if i + 1 != n {
                next.push(RuntimeMessage::Watermark { watermark_ns });
                msgs = next;
            }
        }
        Ok(terminal)
    }
}

/// Async source→sink smoke harness with bounded mpsc.
pub async fn run_bounded_chain(
    capacity: usize,
    mut produce: impl FnMut() -> Option<RuntimeMessage>,
    mut consume: impl FnMut(RuntimeMessage),
) -> Result<(), RuntimeError> {
    let (tx, mut rx) = mpsc::channel::<RuntimeMessage>(capacity.max(1));
    while let Some(msg) = produce() {
        // Prefer control: if channel full, only allow control via try_reserve pattern.
        match &msg {
            RuntimeMessage::Control(_) => {
                // Busy-wait briefly for control delivery under load.
                loop {
                    match tx.try_send(msg.clone()) {
                        Ok(()) => break,
                        Err(mpsc::error::TrySendError::Full(_)) => {
                            tokio::task::yield_now().await;
                        }
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            return Err(RuntimeError::Message("channel closed".into()));
                        }
                    }
                }
            }
            _ => {
                tx.try_send(msg)
                    .map_err(|_| RuntimeError::ChannelFull("source".into()))?;
            }
        }
    }
    drop(tx);
    while let Some(msg) = rx.recv().await {
        if matches!(msg, RuntimeMessage::Control(ControlMessage::Cancel)) {
            return Err(RuntimeError::Cancelled);
        }
        consume(msg);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::RuntimeBatch;
    use crate::operator::{Operator, OperatorMetrics};
    use arrow::array::Int64Array;
    use arrow::datatypes::{DataType, Field, Schema};
    use arrow::record_batch::RecordBatch;
    use faultline_ingest::SignalKind;
    use std::sync::Arc;

    struct Passthrough {
        id: String,
        metrics: OperatorMetrics,
    }

    impl Passthrough {
        fn new(id: &str) -> Self {
            Self {
                id: id.into(),
                metrics: OperatorMetrics {
                    operator_id: id.into(),
                    channel_capacity: 8,
                    ..Default::default()
                },
            }
        }
    }

    impl Operator for Passthrough {
        fn id(&self) -> &str {
            &self.id
        }
        fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
            self.metrics.batches_in += 1;
            self.metrics.batches_out += 1;
            self.metrics.rows_in += batch.batch.num_rows() as u64;
            self.metrics.rows_out += batch.batch.num_rows() as u64;
            Ok(vec![batch])
        }
        fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError> {
            self.metrics.current_watermark_ns = watermark_ns;
            Ok(Vec::new())
        }
        fn metrics(&self) -> OperatorMetrics {
            self.metrics.clone()
        }
    }

    fn tiny_batch() -> RuntimeBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int64, false)]));
        let batch =
            RecordBatch::try_new(schema, vec![Arc::new(Int64Array::from(vec![1, 2, 3]))]).unwrap();
        RuntimeBatch {
            signal: SignalKind::Metrics,
            batch,
            watermark_ns: None,
        }
    }

    #[test]
    fn one_source_one_sink() {
        let mut rt = SyncRuntime::new(vec![Box::new(Passthrough::new("src"))], 4);
        let out = rt.push_batch(tiny_batch()).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].batch.num_rows(), 3);
    }

    #[test]
    fn multi_operator_chain() {
        let mut rt = SyncRuntime::new(
            vec![
                Box::new(Passthrough::new("a")),
                Box::new(Passthrough::new("b")),
            ],
            8,
        );
        let out = rt.push_batch(tiny_batch()).unwrap();
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn cancellation() {
        let mut rt = SyncRuntime::new(vec![Box::new(Passthrough::new("a"))], 2);
        rt.push_control(ControlMessage::Cancel).unwrap();
        assert!(matches!(
            rt.push_batch(tiny_batch()),
            Err(RuntimeError::Cancelled)
        ));
    }
}
