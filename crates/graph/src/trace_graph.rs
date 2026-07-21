//! Trace DAG assembly with missing-parent detection.

use faultline_common::{SpanEvent, SpanStatus, TelemetryEnvelope, TelemetryPayload};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// Serializable span node in a trace DAG.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceSpanNode {
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub service: Option<String>,
    pub operation: String,
    pub start_time_ns: i64,
    pub end_time_ns: i64,
    pub duration_ns: i64,
    pub status: SpanStatus,
    pub peer_service: Option<String>,
    pub missing_parent: bool,
}

/// Assembled trace DAG.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceDag {
    pub trace_id: String,
    pub spans: Vec<TraceSpanNode>,
    pub incomplete: bool,
}

/// Collection of traces keyed by trace_id.
#[derive(Clone, Debug, Default)]
pub struct TraceStore {
    traces: IndexMap<String, Vec<(Option<String>, SpanEvent)>>,
}

impl TraceStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ingest_envelope(&mut self, envelope: &TelemetryEnvelope) {
        let TelemetryPayload::Span(span) = &envelope.payload else {
            return;
        };
        self.traces
            .entry(span.trace_id.clone())
            .or_default()
            .push((envelope.service.clone(), span.clone()));
    }

    pub fn from_envelopes_until(envelopes: &[TelemetryEnvelope], cursor_ns: i64) -> Self {
        let mut store = Self::new();
        for env in envelopes.iter().filter(|e| e.event_time_ns <= cursor_ns) {
            store.ingest_envelope(env);
        }
        store
    }

    pub fn get(&self, trace_id: &str) -> Option<TraceDag> {
        let spans = self.traces.get(trace_id)?;
        Some(assemble_dag(trace_id, spans))
    }

    pub fn list_ids(&self) -> Vec<String> {
        let mut ids: Vec<_> = self.traces.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn all_dags(&self) -> Vec<TraceDag> {
        let mut out: Vec<_> = self
            .traces
            .iter()
            .map(|(id, spans)| assemble_dag(id, spans))
            .collect();
        out.sort_by(|a, b| a.trace_id.cmp(&b.trace_id));
        out
    }
}

fn assemble_dag(trace_id: &str, spans: &[(Option<String>, SpanEvent)]) -> TraceDag {
    let present: std::collections::HashSet<&str> =
        spans.iter().map(|(_, s)| s.span_id.as_str()).collect();

    let mut nodes: Vec<TraceSpanNode> = spans
        .iter()
        .map(|(service, span)| {
            let missing_parent = match &span.parent_span_id {
                Some(pid) => !present.contains(pid.as_str()),
                None => false,
            };
            TraceSpanNode {
                span_id: span.span_id.clone(),
                parent_span_id: span.parent_span_id.clone(),
                service: service.clone(),
                operation: span.operation.clone(),
                start_time_ns: span.start_time_ns,
                end_time_ns: span.end_time_ns,
                duration_ns: span.duration_ns,
                status: span.status,
                peer_service: span.peer_service.clone(),
                missing_parent,
            }
        })
        .collect();

    nodes.sort_by(|a, b| {
        a.start_time_ns
            .cmp(&b.start_time_ns)
            .then_with(|| a.span_id.cmp(&b.span_id))
    });

    let incomplete = nodes.iter().any(|n| n.missing_parent);
    TraceDag {
        trace_id: trace_id.to_owned(),
        spans: nodes,
        incomplete,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use faultline_common::{EventId, SCHEMA_VERSION, SpanKind, TelemetrySignal};

    fn env(service: &str, span: SpanEvent) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(span.span_id.clone()),
            event_time_ns: span.start_time_ns,
            observed_time_ns: span.start_time_ns,
            ingest_time_ns: 0,
            source_id: "t".into(),
            dataset_id: "d".into(),
            incident_id: None,
            environment: "t".into(),
            service: Some(service.into()),
            service_instance: None,
            host: None,
            region: None,
            signal: TelemetrySignal::Span,
            attributes: IndexMap::new(),
            payload: TelemetryPayload::Span(span),
        }
    }

    #[test]
    fn detects_missing_parent() {
        let mut store = TraceStore::new();
        store.ingest_envelope(&env(
            "checkout",
            SpanEvent {
                trace_id: "t1".into(),
                span_id: "child".into(),
                parent_span_id: Some("missing".into()),
                operation: "op".into(),
                start_time_ns: 2,
                end_time_ns: 5,
                duration_ns: 3,
                status: SpanStatus::Ok,
                peer_service: None,
                span_kind: SpanKind::Server,
            },
        ));
        let dag = store.get("t1").unwrap();
        assert!(dag.incomplete);
        assert!(dag.spans[0].missing_parent);
    }

    #[test]
    fn complete_trace_not_flagged() {
        let mut store = TraceStore::new();
        store.ingest_envelope(&env(
            "fe",
            SpanEvent {
                trace_id: "t1".into(),
                span_id: "root".into(),
                parent_span_id: None,
                operation: "a".into(),
                start_time_ns: 1,
                end_time_ns: 10,
                duration_ns: 9,
                status: SpanStatus::Ok,
                peer_service: None,
                span_kind: SpanKind::Server,
            },
        ));
        store.ingest_envelope(&env(
            "be",
            SpanEvent {
                trace_id: "t1".into(),
                span_id: "child".into(),
                parent_span_id: Some("root".into()),
                operation: "b".into(),
                start_time_ns: 2,
                end_time_ns: 8,
                duration_ns: 6,
                status: SpanStatus::Ok,
                peer_service: None,
                span_kind: SpanKind::Server,
            },
        ));
        let dag = store.get("t1").unwrap();
        assert!(!dag.incomplete);
        assert_eq!(dag.spans.len(), 2);
    }
}
