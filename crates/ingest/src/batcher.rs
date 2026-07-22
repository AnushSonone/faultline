//! Signal-specific Arrow RecordBatch batching (TA-022).

use std::sync::Arc;

use arrow::array::{
    Float64Builder, Int64Builder, StringBuilder, UInt64Builder,
};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use faultline_common::{TelemetryEnvelope, TelemetryPayload, TelemetrySignal};
use serde::{Deserialize, Serialize};

use crate::IngestedEvent;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatcherConfig {
    pub max_rows: usize,
    pub max_bytes: usize,
    pub max_age_ns: i64,
}

impl Default for BatcherConfig {
    fn default() -> Self {
        Self {
            max_rows: 256,
            max_bytes: 1 << 20,
            max_age_ns: 1_000_000_000,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalKind {
    Metrics,
    Spans,
    Logs,
    Changes,
}

impl SignalKind {
    pub fn from_envelope(env: &TelemetryEnvelope) -> Option<Self> {
        match env.signal {
            TelemetrySignal::Metric => Some(Self::Metrics),
            TelemetrySignal::Span => Some(Self::Spans),
            TelemetrySignal::Log => Some(Self::Logs),
            TelemetrySignal::Deployment | TelemetrySignal::Configuration => Some(Self::Changes),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct SignalBatch {
    pub kind: SignalKind,
    pub batch: RecordBatch,
    pub min_event_time_ns: i64,
    pub max_event_time_ns: i64,
    pub row_count: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BatcherStats {
    pub flushes: u64,
    pub rows_flushed: u64,
    pub empty_flushes: u64,
}

pub struct SignalBatcher {
    cfg: BatcherConfig,
    kind: SignalKind,
    rows: Vec<IngestedEvent>,
    first_enqueued_ns: Option<i64>,
    stats: BatcherStats,
    processing_time_ns: i64,
}

impl SignalBatcher {
    pub fn new(kind: SignalKind, cfg: BatcherConfig) -> Self {
        Self {
            cfg,
            kind,
            rows: Vec::new(),
            first_enqueued_ns: None,
            stats: BatcherStats::default(),
            processing_time_ns: 0,
        }
    }

    pub fn stats(&self) -> &BatcherStats {
        &self.stats
    }

    pub fn set_processing_time(&mut self, ns: i64) {
        self.processing_time_ns = ns;
    }

    pub fn push(&mut self, event: IngestedEvent) -> Result<Option<SignalBatch>, BatcherError> {
        let Some(kind) = SignalKind::from_envelope(&event.envelope) else {
            return Err(BatcherError::UnsupportedSignal);
        };
        if kind != self.kind {
            return Err(BatcherError::SchemaMismatch {
                expected: format!("{:?}", self.kind),
                got: format!("{kind:?}"),
            });
        }
        if self.rows.is_empty() {
            self.first_enqueued_ns = Some(self.processing_time_ns);
        }
        self.rows.push(event);
        if self.should_flush_rows() {
            return Ok(Some(self.flush()?));
        }
        if self.age_exceeded() {
            return Ok(Some(self.flush()?));
        }
        Ok(None)
    }

    pub fn flush_control(&mut self) -> Result<Option<SignalBatch>, BatcherError> {
        if self.rows.is_empty() {
            self.stats.empty_flushes += 1;
            return Ok(None);
        }
        Ok(Some(self.flush()?))
    }

    pub fn flush_end_of_source(&mut self) -> Result<Option<SignalBatch>, BatcherError> {
        self.flush_control()
    }

    fn should_flush_rows(&self) -> bool {
        self.rows.len() >= self.cfg.max_rows
    }

    fn age_exceeded(&self) -> bool {
        match self.first_enqueued_ns {
            Some(t0) => self.processing_time_ns.saturating_sub(t0) >= self.cfg.max_age_ns,
            None => false,
        }
    }

    fn flush(&mut self) -> Result<SignalBatch, BatcherError> {
        if self.rows.is_empty() {
            self.stats.empty_flushes += 1;
            return Err(BatcherError::Empty);
        }
        // Deterministic row order.
        self.rows.sort_by(|a, b| {
            a.envelope
                .event_time_ns
                .cmp(&b.envelope.event_time_ns)
                .then(a.sequence.cmp(&b.sequence))
                .then(
                    a.envelope
                        .event_id
                        .as_str()
                        .cmp(b.envelope.event_id.as_str()),
                )
        });
        let batch = match self.kind {
            SignalKind::Metrics => build_metrics_batch(&self.rows)?,
            SignalKind::Spans => build_spans_batch(&self.rows)?,
            SignalKind::Logs => build_logs_batch(&self.rows)?,
            SignalKind::Changes => build_changes_batch(&self.rows)?,
        };
        let min_et = self
            .rows
            .iter()
            .map(|r| r.envelope.event_time_ns)
            .min()
            .unwrap_or(0);
        let max_et = self
            .rows
            .iter()
            .map(|r| r.envelope.event_time_ns)
            .max()
            .unwrap_or(0);
        let row_count = self.rows.len();
        self.rows.clear();
        self.first_enqueued_ns = None;
        self.stats.flushes += 1;
        self.stats.rows_flushed += row_count as u64;
        Ok(SignalBatch {
            kind: self.kind,
            batch,
            min_event_time_ns: min_et,
            max_event_time_ns: max_et,
            row_count,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BatcherError {
    #[error("empty flush")]
    Empty,
    #[error("unsupported signal for batcher")]
    UnsupportedSignal,
    #[error("schema mismatch: expected {expected}, got {got}")]
    SchemaMismatch { expected: String, got: String },
    #[error("arrow: {0}")]
    Arrow(String),
}

pub fn metrics_schema() -> Schema {
    Schema::new(vec![
        Field::new("event_id", DataType::Utf8, false),
        Field::new("event_time_ns", DataType::Int64, false),
        Field::new("ingest_sequence", DataType::UInt64, false),
        Field::new("service", DataType::Utf8, true),
        Field::new("name", DataType::Utf8, false),
        Field::new("value", DataType::Float64, false),
    ])
}

pub fn spans_schema() -> Schema {
    Schema::new(vec![
        Field::new("event_id", DataType::Utf8, false),
        Field::new("event_time_ns", DataType::Int64, false),
        Field::new("ingest_sequence", DataType::UInt64, false),
        Field::new("service", DataType::Utf8, true),
        Field::new("trace_id", DataType::Utf8, false),
        Field::new("span_id", DataType::Utf8, false),
        Field::new("parent_span_id", DataType::Utf8, true),
        Field::new("operation", DataType::Utf8, false),
        Field::new("duration_ns", DataType::Int64, false),
        Field::new("status", DataType::Utf8, false),
    ])
}

pub fn logs_schema() -> Schema {
    Schema::new(vec![
        Field::new("event_id", DataType::Utf8, false),
        Field::new("event_time_ns", DataType::Int64, false),
        Field::new("ingest_sequence", DataType::UInt64, false),
        Field::new("service", DataType::Utf8, true),
        Field::new("body", DataType::Utf8, false),
        Field::new("severity_text", DataType::Utf8, true),
    ])
}

pub fn changes_schema() -> Schema {
    Schema::new(vec![
        Field::new("event_id", DataType::Utf8, false),
        Field::new("event_time_ns", DataType::Int64, false),
        Field::new("ingest_sequence", DataType::UInt64, false),
        Field::new("service", DataType::Utf8, true),
        Field::new("change_id", DataType::Utf8, false),
        Field::new("change_type", DataType::Utf8, false),
    ])
}

fn build_metrics_batch(rows: &[IngestedEvent]) -> Result<RecordBatch, BatcherError> {
    let mut event_id = StringBuilder::new();
    let mut event_time = Int64Builder::new();
    let mut seq = UInt64Builder::new();
    let mut service = StringBuilder::new();
    let mut name = StringBuilder::new();
    let mut value = Float64Builder::new();
    for r in rows {
        let TelemetryPayload::Metric(m) = &r.envelope.payload else {
            return Err(BatcherError::SchemaMismatch {
                expected: "metric".into(),
                got: "other".into(),
            });
        };
        event_id.append_value(r.envelope.event_id.as_str());
        event_time.append_value(r.envelope.event_time_ns);
        seq.append_value(r.sequence);
        match &r.envelope.service {
            Some(s) => service.append_value(s),
            None => service.append_null(),
        }
        name.append_value(&m.name);
        value.append_value(m.value);
    }
    RecordBatch::try_new(
        Arc::new(metrics_schema()),
        vec![
            Arc::new(event_id.finish()),
            Arc::new(event_time.finish()),
            Arc::new(seq.finish()),
            Arc::new(service.finish()),
            Arc::new(name.finish()),
            Arc::new(value.finish()),
        ],
    )
    .map_err(|e| BatcherError::Arrow(e.to_string()))
}

fn build_spans_batch(rows: &[IngestedEvent]) -> Result<RecordBatch, BatcherError> {
    let mut event_id = StringBuilder::new();
    let mut event_time = Int64Builder::new();
    let mut seq = UInt64Builder::new();
    let mut service = StringBuilder::new();
    let mut trace_id = StringBuilder::new();
    let mut span_id = StringBuilder::new();
    let mut parent = StringBuilder::new();
    let mut operation = StringBuilder::new();
    let mut duration = Int64Builder::new();
    let mut status = StringBuilder::new();
    for r in rows {
        let TelemetryPayload::Span(s) = &r.envelope.payload else {
            return Err(BatcherError::SchemaMismatch {
                expected: "span".into(),
                got: "other".into(),
            });
        };
        event_id.append_value(r.envelope.event_id.as_str());
        event_time.append_value(r.envelope.event_time_ns);
        seq.append_value(r.sequence);
        match &r.envelope.service {
            Some(sv) => service.append_value(sv),
            None => service.append_null(),
        }
        trace_id.append_value(&s.trace_id);
        span_id.append_value(&s.span_id);
        match &s.parent_span_id {
            Some(p) => parent.append_value(p),
            None => parent.append_null(),
        }
        operation.append_value(&s.operation);
        duration.append_value(s.duration_ns);
        status.append_value(format!("{:?}", s.status).to_ascii_lowercase());
    }
    RecordBatch::try_new(
        Arc::new(spans_schema()),
        vec![
            Arc::new(event_id.finish()),
            Arc::new(event_time.finish()),
            Arc::new(seq.finish()),
            Arc::new(service.finish()),
            Arc::new(trace_id.finish()),
            Arc::new(span_id.finish()),
            Arc::new(parent.finish()),
            Arc::new(operation.finish()),
            Arc::new(duration.finish()),
            Arc::new(status.finish()),
        ],
    )
    .map_err(|e| BatcherError::Arrow(e.to_string()))
}

fn build_logs_batch(rows: &[IngestedEvent]) -> Result<RecordBatch, BatcherError> {
    let mut event_id = StringBuilder::new();
    let mut event_time = Int64Builder::new();
    let mut seq = UInt64Builder::new();
    let mut service = StringBuilder::new();
    let mut body = StringBuilder::new();
    let mut severity = StringBuilder::new();
    for r in rows {
        let TelemetryPayload::Log(l) = &r.envelope.payload else {
            return Err(BatcherError::SchemaMismatch {
                expected: "log".into(),
                got: "other".into(),
            });
        };
        event_id.append_value(r.envelope.event_id.as_str());
        event_time.append_value(r.envelope.event_time_ns);
        seq.append_value(r.sequence);
        match &r.envelope.service {
            Some(s) => service.append_value(s),
            None => service.append_null(),
        }
        body.append_value(&l.body);
        match &l.severity_text {
            Some(s) => severity.append_value(s),
            None => severity.append_null(),
        }
    }
    RecordBatch::try_new(
        Arc::new(logs_schema()),
        vec![
            Arc::new(event_id.finish()),
            Arc::new(event_time.finish()),
            Arc::new(seq.finish()),
            Arc::new(service.finish()),
            Arc::new(body.finish()),
            Arc::new(severity.finish()),
        ],
    )
    .map_err(|e| BatcherError::Arrow(e.to_string()))
}

fn build_changes_batch(rows: &[IngestedEvent]) -> Result<RecordBatch, BatcherError> {
    let mut event_id = StringBuilder::new();
    let mut event_time = Int64Builder::new();
    let mut seq = UInt64Builder::new();
    let mut service = StringBuilder::new();
    let mut change_id = StringBuilder::new();
    let mut change_type = StringBuilder::new();
    for r in rows {
        let TelemetryPayload::Change(c) = &r.envelope.payload else {
            return Err(BatcherError::SchemaMismatch {
                expected: "change".into(),
                got: "other".into(),
            });
        };
        event_id.append_value(r.envelope.event_id.as_str());
        event_time.append_value(r.envelope.event_time_ns);
        seq.append_value(r.sequence);
        match &r.envelope.service {
            Some(s) => service.append_value(s),
            None => service.append_null(),
        }
        change_id.append_value(&c.change_id);
        change_type.append_value(format!("{:?}", c.change_type).to_ascii_lowercase());
    }
    RecordBatch::try_new(
        Arc::new(changes_schema()),
        vec![
            Arc::new(event_id.finish()),
            Arc::new(event_time.finish()),
            Arc::new(seq.finish()),
            Arc::new(service.finish()),
            Arc::new(change_id.finish()),
            Arc::new(change_type.finish()),
        ],
    )
    .map_err(|e| BatcherError::Arrow(e.to_string()))
}

/// Multi-signal fan-out batcher used by the streaming session path.
pub struct MultiSignalBatcher {
    pub metrics: SignalBatcher,
    pub spans: SignalBatcher,
    pub logs: SignalBatcher,
    pub changes: SignalBatcher,
}

impl MultiSignalBatcher {
    pub fn new(cfg: BatcherConfig) -> Self {
        Self {
            metrics: SignalBatcher::new(SignalKind::Metrics, cfg.clone()),
            spans: SignalBatcher::new(SignalKind::Spans, cfg.clone()),
            logs: SignalBatcher::new(SignalKind::Logs, cfg.clone()),
            changes: SignalBatcher::new(SignalKind::Changes, cfg),
        }
    }

    pub fn set_processing_time(&mut self, ns: i64) {
        self.metrics.set_processing_time(ns);
        self.spans.set_processing_time(ns);
        self.logs.set_processing_time(ns);
        self.changes.set_processing_time(ns);
    }

    pub fn push(&mut self, event: IngestedEvent) -> Result<Vec<SignalBatch>, BatcherError> {
        let kind = SignalKind::from_envelope(&event.envelope)
            .ok_or(BatcherError::UnsupportedSignal)?;
        let flushed = match kind {
            SignalKind::Metrics => self.metrics.push(event)?,
            SignalKind::Spans => self.spans.push(event)?,
            SignalKind::Logs => self.logs.push(event)?,
            SignalKind::Changes => self.changes.push(event)?,
        };
        Ok(flushed.into_iter().collect())
    }

    pub fn flush_all(&mut self) -> Result<Vec<SignalBatch>, BatcherError> {
        let mut out = Vec::new();
        for b in [
            self.metrics.flush_end_of_source()?,
            self.spans.flush_end_of_source()?,
            self.logs.flush_end_of_source()?,
            self.changes.flush_end_of_source()?,
        ]
        .into_iter()
        .flatten()
        {
            out.push(b);
        }
        Ok(out)
    }

    pub fn reset(&mut self) {
        let cfg = self.metrics.cfg.clone();
        *self = Self::new(cfg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::partition_key_for;
    use faultline_common::{
        EventId, MetricKind, MetricPoint, TelemetryEnvelope, TelemetryPayload, TelemetrySignal,
        SCHEMA_VERSION,
    };
    use indexmap::IndexMap;

    fn metric(id: &str, t: i64) -> IngestedEvent {
        let envelope = TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(id),
            event_time_ns: t,
            observed_time_ns: t,
            ingest_time_ns: 0,
            source_id: "t".into(),
            dataset_id: "d".into(),
            incident_id: None,
            environment: "test".into(),
            service: Some("frontend".into()),
            service_instance: None,
            host: None,
            region: None,
            signal: TelemetrySignal::Metric,
            attributes: IndexMap::new(),
            payload: TelemetryPayload::Metric(MetricPoint {
                name: "frontend_lat".into(),
                kind: MetricKind::Gauge,
                value: 1.0,
                unit: None,
            }),
        };
        IngestedEvent {
            sequence: 1,
            partition_key: partition_key_for(&envelope),
            envelope,
        }
    }

    #[test]
    fn max_row_flush() {
        let mut b = SignalBatcher::new(
            SignalKind::Metrics,
            BatcherConfig {
                max_rows: 2,
                ..Default::default()
            },
        );
        assert!(b.push(metric("a", 1)).unwrap().is_none());
        let flushed = b.push(metric("b", 2)).unwrap().unwrap();
        assert_eq!(flushed.row_count, 2);
    }

    #[test]
    fn empty_control_flush() {
        let mut b = SignalBatcher::new(SignalKind::Metrics, BatcherConfig::default());
        assert!(b.flush_control().unwrap().is_none());
        assert_eq!(b.stats().empty_flushes, 1);
    }

    #[test]
    fn deterministic_order() {
        let mut b = SignalBatcher::new(
            SignalKind::Metrics,
            BatcherConfig {
                max_rows: 10,
                ..Default::default()
            },
        );
        let mut e2 = metric("b", 20);
        e2.sequence = 2;
        let mut e1 = metric("a", 10);
        e1.sequence = 1;
        b.push(e2).unwrap();
        let batch = b.push(e1).unwrap();
        assert!(batch.is_none());
        let out = b.flush_control().unwrap().unwrap();
        let ids = out
            .batch
            .column(0)
            .as_any()
            .downcast_ref::<arrow::array::StringArray>()
            .unwrap();
        assert_eq!(ids.value(0), "a");
        assert_eq!(ids.value(1), "b");
    }

    #[test]
    fn schema_round_trip_metrics() {
        let schema = metrics_schema();
        assert_eq!(schema.field(0).name(), "event_id");
        let mut b = SignalBatcher::new(SignalKind::Metrics, BatcherConfig::default());
        b.push(metric("x", 1)).unwrap();
        let batch = b.flush_control().unwrap().unwrap();
        assert_eq!(batch.batch.num_columns(), 6);
        assert_eq!(batch.batch.schema().as_ref(), &schema);
    }
}
