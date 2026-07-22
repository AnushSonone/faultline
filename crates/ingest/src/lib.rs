//! Backend ingest: schema validation, sequence, dedupe, bounded channel, partition routing.

use std::collections::HashSet;

use faultline_common::{
    EventId, FaultlineError, TelemetryEnvelope, TelemetryPayload, TelemetrySignal, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::mpsc;

pub const DEFAULT_CAPACITY: usize = 1024;

/// Accepted event with ingest metadata.
#[derive(Clone, Debug, PartialEq)]
pub struct IngestedEvent {
    pub sequence: u64,
    pub partition_key: String,
    pub envelope: TelemetryEnvelope,
}

/// Counters exposed for health / metrics.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IngestMetrics {
    pub accepted: u64,
    pub duplicates: u64,
    pub rejected: u64,
    pub enqueued: u64,
}

#[derive(Debug, Error)]
pub enum IngestError {
    #[error(transparent)]
    Validation(#[from] FaultlineError),
    #[error("ingest channel full")]
    ChannelFull,
    #[error("ingest channel closed")]
    ChannelClosed,
}

/// Validate schema, assign ingest sequence, dedupe by `event_id`, bounded queue, partition by signal.
pub struct IngestPipeline {
    seen: HashSet<EventId>,
    next_seq: u64,
    tx: mpsc::Sender<IngestedEvent>,
    rx: Option<mpsc::Receiver<IngestedEvent>>,
    metrics: IngestMetrics,
    capacity: usize,
}

impl IngestPipeline {
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let (tx, rx) = mpsc::channel(capacity);
        Self {
            seen: HashSet::new(),
            next_seq: 1,
            tx,
            rx: Some(rx),
            metrics: IngestMetrics::default(),
            capacity,
        }
    }

    pub fn with_default_capacity() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn metrics(&self) -> &IngestMetrics {
        &self.metrics
    }

    /// Take the receiver once (for a consumer task).
    pub fn take_receiver(&mut self) -> Option<mpsc::Receiver<IngestedEvent>> {
        self.rx.take()
    }

    /// Validate + dedupe + enqueue. Returns `Ok(None)` when duplicate.
    pub async fn ingest(
        &mut self,
        mut envelope: TelemetryEnvelope,
    ) -> Result<Option<IngestedEvent>, IngestError> {
        validate_envelope(&envelope)?;

        if !self.seen.insert(envelope.event_id.clone()) {
            self.metrics.duplicates += 1;
            return Ok(None);
        }

        let sequence = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        envelope.ingest_time_ns = sequence as i64; // placeholder until wall clock wired
        let partition_key = partition_key_for(&envelope);
        let event = IngestedEvent {
            sequence,
            partition_key,
            envelope,
        };

        match self.tx.try_send(event.clone()) {
            Ok(()) => {
                self.metrics.accepted += 1;
                self.metrics.enqueued += 1;
                Ok(Some(event))
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.metrics.rejected += 1;
                // Roll back dedupe so retry can succeed later.
                self.seen.remove(&event.envelope.event_id);
                self.next_seq = sequence;
                Err(IngestError::ChannelFull)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.metrics.rejected += 1;
                Err(IngestError::ChannelClosed)
            }
        }
    }

    /// Blocking-style helper for tests / sync callers.
    pub fn try_ingest(
        &mut self,
        envelope: TelemetryEnvelope,
    ) -> Result<Option<IngestedEvent>, IngestError> {
        // Use try_send path via block_on-free logic duplicated lightly.
        validate_envelope(&envelope)?;
        if !self.seen.insert(envelope.event_id.clone()) {
            self.metrics.duplicates += 1;
            return Ok(None);
        }
        let sequence = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        let mut envelope = envelope;
        envelope.ingest_time_ns = sequence as i64;
        let partition_key = partition_key_for(&envelope);
        let event = IngestedEvent {
            sequence,
            partition_key,
            envelope,
        };
        match self.tx.try_send(event.clone()) {
            Ok(()) => {
                self.metrics.accepted += 1;
                self.metrics.enqueued += 1;
                Ok(Some(event))
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.metrics.rejected += 1;
                self.seen.remove(&event.envelope.event_id);
                self.next_seq = sequence;
                Err(IngestError::ChannelFull)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.metrics.rejected += 1;
                Err(IngestError::ChannelClosed)
            }
        }
    }

    pub fn reset_dedupe(&mut self) {
        self.seen.clear();
    }
}

fn validate_envelope(envelope: &TelemetryEnvelope) -> Result<(), FaultlineError> {
    if envelope.schema_version != SCHEMA_VERSION {
        return Err(FaultlineError::SchemaVersion {
            expected: SCHEMA_VERSION,
            got: envelope.schema_version,
        });
    }
    if envelope.event_id.as_str().is_empty() {
        return Err(FaultlineError::InvalidEvent("event_id empty".into()));
    }
    Ok(())
}

/// Partition key by signal (spec §15.1).
pub fn partition_key_for(envelope: &TelemetryEnvelope) -> String {
    match (&envelope.signal, &envelope.payload) {
        (TelemetrySignal::Metric, TelemetryPayload::Metric(m)) => {
            let svc = envelope.service.as_deref().unwrap_or("unknown");
            format!("metric:{svc}:{}", m.name)
        }
        (TelemetrySignal::Span, TelemetryPayload::Span(s)) => {
            format!("span:{}", s.trace_id)
        }
        (TelemetrySignal::Log, _) => {
            let svc = envelope.service.as_deref().unwrap_or("unknown");
            format!("log:{svc}")
        }
        (TelemetrySignal::Deployment | TelemetrySignal::Configuration, _) => {
            let svc = envelope.service.as_deref().unwrap_or("unknown");
            format!("change:{svc}")
        }
        (TelemetrySignal::Alert | TelemetrySignal::Annotation, _) => {
            let svc = envelope.service.as_deref().unwrap_or("unknown");
            format!("other:{svc}")
        }
        (TelemetrySignal::Control, _) => "control".into(),
        _ => {
            let svc = envelope.service.as_deref().unwrap_or("unknown");
            format!("misc:{svc}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use faultline_common::{MetricKind, MetricPoint};
    use indexmap::IndexMap;

    fn sample_metric(id: &str) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(id),
            event_time_ns: 100,
            observed_time_ns: 100,
            ingest_time_ns: 0,
            source_id: "test".into(),
            dataset_id: "demo".into(),
            incident_id: None,
            environment: "test".into(),
            service: Some("frontend".into()),
            service_instance: None,
            host: None,
            region: None,
            signal: TelemetrySignal::Metric,
            attributes: IndexMap::new(),
            payload: TelemetryPayload::Metric(MetricPoint {
                name: "cpu".into(),
                kind: MetricKind::Gauge,
                value: 0.5,
                unit: None,
            }),
        }
    }

    #[test]
    fn dedupe_drops_duplicate_event_id() {
        let mut pipe = IngestPipeline::new(8);
        let a = pipe.try_ingest(sample_metric("e1")).unwrap();
        assert!(a.is_some());
        assert_eq!(a.unwrap().sequence, 1);

        let dup = pipe.try_ingest(sample_metric("e1")).unwrap();
        assert!(dup.is_none());
        assert_eq!(pipe.metrics().duplicates, 1);
        assert_eq!(pipe.metrics().accepted, 1);

        let b = pipe.try_ingest(sample_metric("e2")).unwrap();
        assert_eq!(b.unwrap().sequence, 2);
    }

    #[test]
    fn channel_is_bounded() {
        let mut pipe = IngestPipeline::new(1);
        // Keep receiver so channel stays open but fills.
        let _rx = pipe.take_receiver();
        pipe.try_ingest(sample_metric("a")).unwrap();
        let err = pipe.try_ingest(sample_metric("b")).unwrap_err();
        assert!(matches!(err, IngestError::ChannelFull));
        assert_eq!(pipe.metrics().rejected, 1);
    }

    #[test]
    fn rejects_bad_schema_version() {
        let mut pipe = IngestPipeline::new(4);
        let mut env = sample_metric("x");
        env.schema_version = 99;
        assert!(pipe.try_ingest(env).is_err());
    }
}
