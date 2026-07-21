//! Canonical telemetry envelope and signal payloads (spec §12).

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ids::EventId;
use crate::time::TimeNs;

/// Canonical wrapper for every ingested / replayed telemetry record.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TelemetryEnvelope {
    pub schema_version: u16,
    pub event_id: EventId,
    pub event_time_ns: TimeNs,
    pub observed_time_ns: TimeNs,
    pub ingest_time_ns: TimeNs,
    pub source_id: String,
    pub dataset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incident_id: Option<String>,
    pub environment: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_instance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    pub signal: TelemetrySignal,
    #[serde(default)]
    pub attributes: IndexMap<String, Value>,
    pub payload: TelemetryPayload,
}

/// High-level signal classification for an envelope.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetrySignal {
    Metric,
    Span,
    Log,
    Deployment,
    Configuration,
    Alert,
    Annotation,
    Control,
}

/// Typed payload body matched to a [`TelemetrySignal`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum TelemetryPayload {
    Metric(MetricPoint),
    Span(SpanEvent),
    Log(LogEvent),
    Change(ChangeEvent),
    Control(ReplayControl),
}

/// Metric sample payload.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MetricPoint {
    pub name: String,
    pub kind: MetricKind,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricKind {
    Gauge,
    Counter,
    HistogramSample,
}

/// Distributed span payload.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpanEvent {
    pub trace_id: String,
    pub span_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
    pub operation: String,
    pub start_time_ns: TimeNs,
    pub end_time_ns: TimeNs,
    pub duration_ns: i64,
    pub status: SpanStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_service: Option<String>,
    pub span_kind: SpanKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanStatus {
    Unset,
    Ok,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanKind {
    Internal,
    Server,
    Client,
    Producer,
    Consumer,
}

/// Log line / structured log payload.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LogEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity_number: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity_text: Option<String>,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
}

/// Deployment / configuration / feature-flag change payload.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChangeEvent {
    pub change_id: String,
    pub change_type: ChangeType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_after: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(default)]
    pub metadata: IndexMap<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Deployment,
    Config,
    FeatureFlag,
    Rollback,
}

/// Replay / control-plane message carried on the event stream.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReplayControl {
    pub kind: ReplayControlKind,
    #[serde(default)]
    pub metadata: IndexMap<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayControlKind {
    IncidentStart,
    IncidentEnd,
    WatermarkHint,
    CheckpointRequest,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SCHEMA_VERSION;
    use crate::ids::{deterministic_event_id, DeterministicIdFields};

    fn sample_metric_envelope() -> TelemetryEnvelope {
        let fields = DeterministicIdFields {
            dataset_id: "rcaeval-re2-ob",
            dataset_version: "v1",
            source_id: "metrics.json",
            event_time_ns: 1_700_000_000_000_000_000,
            signal: TelemetrySignal::Metric,
            stable_key: "frontend|cpu_usage",
        };
        let event_id = deterministic_event_id(&fields);

        let mut attributes = IndexMap::new();
        attributes.insert("cluster".into(), Value::String("ob-prod".into()));

        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id,
            event_time_ns: fields.event_time_ns,
            observed_time_ns: fields.event_time_ns + 1_000_000,
            ingest_time_ns: fields.event_time_ns + 5_000_000,
            source_id: fields.source_id.to_owned(),
            dataset_id: fields.dataset_id.to_owned(),
            incident_id: Some("cart_mem_1".into()),
            environment: "prod".into(),
            service: Some("frontend".into()),
            service_instance: Some("frontend-0".into()),
            host: Some("node-a".into()),
            region: Some("us-east-1".into()),
            signal: TelemetrySignal::Metric,
            attributes,
            payload: TelemetryPayload::Metric(MetricPoint {
                name: "cpu_usage".into(),
                kind: MetricKind::Gauge,
                value: 0.82,
                unit: Some("ratio".into()),
            }),
        }
    }

    #[test]
    fn metric_envelope_json_round_trip() {
        let original = sample_metric_envelope();
        let json = serde_json::to_string_pretty(&original).unwrap();
        let back: TelemetryEnvelope = serde_json::from_str(&json).unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn span_log_change_control_json_round_trip() {
        let cases = [
            TelemetryPayload::Span(SpanEvent {
                trace_id: "abc".into(),
                span_id: "def".into(),
                parent_span_id: None,
                operation: "GET /cart".into(),
                start_time_ns: 1,
                end_time_ns: 10,
                duration_ns: 9,
                status: SpanStatus::Ok,
                peer_service: Some("cart".into()),
                span_kind: SpanKind::Client,
            }),
            TelemetryPayload::Log(LogEvent {
                severity_number: Some(17),
                severity_text: Some("ERROR".into()),
                body: "oom".into(),
                template_id: None,
                trace_id: None,
                span_id: None,
            }),
            TelemetryPayload::Change(ChangeEvent {
                change_id: "deploy-1".into(),
                change_type: ChangeType::Deployment,
                version_before: Some("1.0".into()),
                version_after: Some("1.1".into()),
                actor: Some("ci".into()),
                metadata: IndexMap::new(),
            }),
            TelemetryPayload::Control(ReplayControl {
                kind: ReplayControlKind::WatermarkHint,
                metadata: IndexMap::new(),
            }),
        ];

        for payload in cases {
            let json = serde_json::to_string(&payload).unwrap();
            let back: TelemetryPayload = serde_json::from_str(&json).unwrap();
            assert_eq!(payload, back);
        }
    }

    #[test]
    fn event_id_on_envelope_is_stable() {
        let a = sample_metric_envelope();
        let b = sample_metric_envelope();
        assert_eq!(a.event_id, b.event_id);
    }
}
