//! Topology snapshot / delta projections (precomputed OK for M2).

use faultline_common::TelemetryEnvelope;
use faultline_graph::{ServiceGraph, ServiceGraphSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TopologyProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub graph: ServiceGraphSnapshot,
}

/// Build topology at cursor from envelopes (full snapshot).
pub fn build_topology(
    envelopes: &[TelemetryEnvelope],
    cursor_event_time_ns: i64,
    projection_version: u64,
) -> TopologyProjection {
    let graph = ServiceGraph::from_envelopes_until(envelopes, cursor_event_time_ns).snapshot();
    TopologyProjection {
        projection_version,
        cursor_event_time_ns,
        graph,
    }
}
