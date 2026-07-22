//! Trace availability projection.

use faultline_common::TelemetryEnvelope;
use faultline_graph::{TraceDag, TraceStore};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceAvailable {
    pub trace_id: String,
    pub span_count: usize,
    pub incomplete: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub traces: Vec<TraceAvailable>,
}

pub fn build_trace_projection(
    envelopes: &[TelemetryEnvelope],
    cursor_event_time_ns: i64,
    projection_version: u64,
) -> TraceProjection {
    let store = TraceStore::from_envelopes_until(envelopes, cursor_event_time_ns);
    let mut traces: Vec<_> = store
        .all_dags()
        .into_iter()
        .map(|dag: TraceDag| TraceAvailable {
            trace_id: dag.trace_id,
            span_count: dag.spans.len(),
            incomplete: dag.incomplete,
        })
        .collect();
    traces.sort_by(|a, b| a.trace_id.cmp(&b.trace_id));

    TraceProjection {
        projection_version,
        cursor_event_time_ns,
        traces,
    }
}

pub fn get_trace(
    envelopes: &[TelemetryEnvelope],
    trace_id: &str,
    cursor_event_time_ns: i64,
) -> Option<TraceDag> {
    TraceStore::from_envelopes_until(envelopes, cursor_event_time_ns).get(trace_id)
}
