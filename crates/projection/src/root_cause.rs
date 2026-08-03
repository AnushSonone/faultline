//! Root-cause ranking projection (TA-034). Cursor-bounded rebuild over the
//! inference pipeline; no ground-truth labels anywhere in this path.

use faultline_common::TelemetryEnvelope;
use faultline_inference::evidence::{evidence_for_ranking, Evidence};
use faultline_inference::evidence_graph::{build_evidence_graph, EvidenceGraph};
use faultline_inference::features::{compute_features, FeatureConfig};
use faultline_inference::ranking::{rank_candidates, RankingWeights, ScoredCandidate};
use serde::{Deserialize, Serialize};

/// Candidates included in the evidence graph.
const EVIDENCE_GRAPH_TOP_N: usize = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RootCauseProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub incident_onset_ns: Option<i64>,
    /// Claim-disciplined framing for the UI: likely causes, not proven ones.
    pub language: String,
    pub candidates: Vec<ScoredCandidate>,
    pub evidence: Vec<Evidence>,
}

/// Evidence graph projection, emitted as WS `evidence.updated` (TA-038).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvidenceGraphProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub graph: EvidenceGraph,
}

/// Build the ranked root-cause view from envelopes at or before `cursor_ns`.
/// Precomputed-style rebuild, mirroring `build_correlation_precomputed`.
pub fn build_root_causes(
    incident_id: &str,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
    projection_version: u64,
) -> RootCauseProjection {
    build_inference_projections(incident_id, envelopes, cursor_ns, projection_version).0
}

/// Build root causes and the evidence graph from one shared feature pass.
pub fn build_inference_projections(
    incident_id: &str,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
    projection_version: u64,
) -> (RootCauseProjection, EvidenceGraphProjection) {
    let visible: Vec<TelemetryEnvelope> = envelopes
        .iter()
        .filter(|e| e.event_time_ns <= cursor_ns)
        .cloned()
        .collect();
    let features = compute_features(&visible, &FeatureConfig::default());
    let ranking = rank_candidates(&features, &RankingWeights::default());
    let evidence = evidence_for_ranking(incident_id, &features, &ranking);
    let graph = build_evidence_graph(incident_id, &features, &ranking, EVIDENCE_GRAPH_TOP_N);
    (
        RootCauseProjection {
            projection_version,
            cursor_event_time_ns: cursor_ns,
            incident_onset_ns: features.incident_onset_ns,
            language:
                "likely causes ranked by evidence; supports/contradicts, not proven causation"
                    .into(),
            candidates: ranking.candidates,
            evidence,
        },
        EvidenceGraphProjection {
            projection_version,
            cursor_event_time_ns: cursor_ns,
            graph,
        },
    )
}
