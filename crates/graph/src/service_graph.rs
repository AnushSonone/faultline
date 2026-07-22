//! Incremental service graph from spans.

use faultline_common::{SpanEvent, SpanStatus, TelemetryEnvelope, TelemetryPayload};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// Serializable service-graph snapshot for projections / API.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ServiceGraphSnapshot {
    pub nodes: Vec<ServiceNode>,
    pub edges: Vec<ServiceEdge>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServiceNode {
    pub service: String,
    pub request_count: u64,
    pub error_count: u64,
    pub total_duration_ns: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServiceEdge {
    pub from: String,
    pub to: String,
    pub request_count: u64,
    pub error_count: u64,
    pub total_duration_ns: i64,
}

#[derive(Clone, Debug, Default)]
struct NodeAgg {
    request_count: u64,
    error_count: u64,
    total_duration_ns: i64,
}

#[derive(Clone, Debug, Default)]
struct EdgeAgg {
    request_count: u64,
    error_count: u64,
    total_duration_ns: i64,
}

/// Builds caller → callee edges from span envelopes.
#[derive(Clone, Debug, Default)]
pub struct ServiceGraph {
    nodes: IndexMap<String, NodeAgg>,
    edges: IndexMap<(String, String), EdgeAgg>,
    /// span_id → service for parent-chain resolution
    span_service: IndexMap<String, String>,
}

impl ServiceGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ingest_envelope(&mut self, envelope: &TelemetryEnvelope) {
        let Some(service) = envelope.service.as_deref() else {
            return;
        };
        let TelemetryPayload::Span(span) = &envelope.payload else {
            return;
        };
        self.ingest_span(service, span);
    }

    pub fn ingest_span(&mut self, service: &str, span: &SpanEvent) {
        self.span_service
            .insert(span.span_id.clone(), service.to_owned());

        let node = self.nodes.entry(service.to_owned()).or_default();
        node.request_count += 1;
        node.total_duration_ns += span.duration_ns;
        if span.status == SpanStatus::Error {
            node.error_count += 1;
        }

        // Prefer explicit peer_service; else resolve parent span's service.
        let callee_peer = span.peer_service.clone();
        if let Some(peer) = callee_peer {
            if peer != service {
                self.add_edge(service, &peer, span);
                self.nodes.entry(peer).or_default();
            }
        } else if let Some(parent_id) = &span.parent_span_id {
            if let Some(parent_svc) = self.span_service.get(parent_id).cloned() {
                if parent_svc != service {
                    // Parent is caller, current service is callee.
                    self.add_edge(&parent_svc, service, span);
                }
            }
        }
    }

    fn add_edge(&mut self, from: &str, to: &str, span: &SpanEvent) {
        let edge = self
            .edges
            .entry((from.to_owned(), to.to_owned()))
            .or_default();
        edge.request_count += 1;
        edge.total_duration_ns += span.duration_ns;
        if span.status == SpanStatus::Error {
            edge.error_count += 1;
        }
    }

    pub fn snapshot(&self) -> ServiceGraphSnapshot {
        let mut nodes: Vec<_> = self
            .nodes
            .iter()
            .map(|(service, agg)| ServiceNode {
                service: service.clone(),
                request_count: agg.request_count,
                error_count: agg.error_count,
                total_duration_ns: agg.total_duration_ns,
            })
            .collect();
        nodes.sort_by(|a, b| a.service.cmp(&b.service));

        let mut edges: Vec<_> = self
            .edges
            .iter()
            .map(|((from, to), agg)| ServiceEdge {
                from: from.clone(),
                to: to.clone(),
                request_count: agg.request_count,
                error_count: agg.error_count,
                total_duration_ns: agg.total_duration_ns,
            })
            .collect();
        edges.sort_by(|a, b| a.from.cmp(&b.from).then_with(|| a.to.cmp(&b.to)));

        ServiceGraphSnapshot { nodes, edges }
    }

    /// Rebuild from envelopes at or before `cursor_ns`.
    pub fn from_envelopes_until(envelopes: &[TelemetryEnvelope], cursor_ns: i64) -> Self {
        let mut g = Self::new();
        for env in envelopes.iter().filter(|e| e.event_time_ns <= cursor_ns) {
            g.ingest_envelope(env);
        }
        g
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use faultline_common::{EventId, SpanKind, TelemetrySignal, SCHEMA_VERSION};
    use indexmap::IndexMap;

    fn span_env(
        service: &str,
        trace: &str,
        span: &str,
        parent: Option<&str>,
        peer: Option<&str>,
    ) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(format!("e-{span}")),
            event_time_ns: 1,
            observed_time_ns: 1,
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
            payload: TelemetryPayload::Span(SpanEvent {
                trace_id: trace.into(),
                span_id: span.into(),
                parent_span_id: parent.map(str::to_owned),
                operation: "op".into(),
                start_time_ns: 1,
                end_time_ns: 10,
                duration_ns: 9,
                status: SpanStatus::Ok,
                peer_service: peer.map(str::to_owned),
                span_kind: SpanKind::Client,
            }),
        }
    }

    #[test]
    fn builds_edge_from_peer_service() {
        let mut g = ServiceGraph::new();
        g.ingest_envelope(&span_env("frontend", "t1", "s1", None, Some("checkout")));
        let snap = g.snapshot();
        assert_eq!(snap.edges.len(), 1);
        assert_eq!(snap.edges[0].from, "frontend");
        assert_eq!(snap.edges[0].to, "checkout");
    }

    #[test]
    fn builds_edge_from_parent_chain() {
        let mut g = ServiceGraph::new();
        g.ingest_envelope(&span_env("frontend", "t1", "s1", None, None));
        g.ingest_envelope(&span_env("checkout", "t1", "s2", Some("s1"), None));
        let snap = g.snapshot();
        assert!(snap
            .edges
            .iter()
            .any(|e| e.from == "frontend" && e.to == "checkout"));
    }
}
