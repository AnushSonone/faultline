//! Causal evidence graph (TA-038, spec 18.6 + 20.7).
//!
//! An explanation structure, not a claim of proven causality: nodes are
//! concrete evidence entities, edges are typed relations, contradicting
//! evidence is always present. Deterministic ids so goldens and the UI can
//! rely on stable identity.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

use crate::features::FeatureSet;
use crate::ranking::Ranking;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceNodeKind {
    Change,
    MetricAnomaly,
    LogPattern,
    ServiceDegradation,
    RootCauseCandidate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceEdgeKind {
    Precedes,
    PropagatesTo,
    ContributesTo,
    CorrelatesWith,
    Contradicts,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvidenceGraphNode {
    pub id: String,
    pub kind: EvidenceNodeKind,
    pub label: String,
    pub service: Option<String>,
    pub time_ns: Option<i64>,
    /// [0, 1]; drives "strongest path" filtering in the UI.
    pub strength: f64,
    pub source_refs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvidenceGraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: EvidenceEdgeKind,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct EvidenceGraph {
    pub incident_id: String,
    pub nodes: Vec<EvidenceGraphNode>,
    pub edges: Vec<EvidenceGraphEdge>,
}

fn short_hash(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    hex::encode(digest)[..10].to_owned()
}

/// Build the evidence graph for the top `top_n` ranked candidates.
pub fn build_evidence_graph(
    incident_id: &str,
    features: &FeatureSet,
    ranking: &Ranking,
    top_n: usize,
) -> EvidenceGraph {
    let mut graph = EvidenceGraph {
        incident_id: incident_id.to_owned(),
        ..Default::default()
    };
    let mut node_ids: BTreeSet<String> = BTreeSet::new();
    let push_node =
        |graph: &mut EvidenceGraph, ids: &mut BTreeSet<String>, node: EvidenceGraphNode| {
            if ids.insert(node.id.clone()) {
                graph.nodes.push(node);
            }
        };
    let mut edge_seq = 0usize;
    let push_edge = |graph: &mut EvidenceGraph,
                     seq: &mut usize,
                     from: &str,
                     to: &str,
                     kind: EvidenceEdgeKind,
                     label: String| {
        *seq += 1;
        graph.edges.push(EvidenceGraphEdge {
            id: format!(
                "ee-{}",
                short_hash(&format!("{incident_id}|{from}|{to}|{kind:?}"))
            ),
            from: from.to_owned(),
            to: to.to_owned(),
            kind,
            label,
        });
    };

    let onsets: std::collections::BTreeMap<&str, i64> = features
        .candidates
        .iter()
        .filter_map(|c| c.onset_ns.map(|t| (c.service.as_str(), t)))
        .collect();

    // Degradation node per anomalous service.
    for candidate in &features.candidates {
        let Some(onset) = candidate.onset_ns else {
            continue;
        };
        push_node(
            &mut graph,
            &mut node_ids,
            EvidenceGraphNode {
                id: format!("deg:{}", candidate.service),
                kind: EvidenceNodeKind::ServiceDegradation,
                label: format!("{} degradation", candidate.service),
                service: Some(candidate.service.clone()),
                time_ns: Some(onset),
                strength: candidate.anomaly_strength,
                source_refs: vec![],
            },
        );
    }

    // Metric anomaly nodes feed their service's degradation.
    for interval in &features.anomaly_intervals {
        let id = format!(
            "metric:{}",
            short_hash(&format!(
                "{}|{}|{}",
                interval.service, interval.metric, interval.start_ns
            ))
        );
        push_node(
            &mut graph,
            &mut node_ids,
            EvidenceGraphNode {
                id: id.clone(),
                kind: EvidenceNodeKind::MetricAnomaly,
                label: format!(
                    "{} anomaly (peak |z| {:.1})",
                    interval.metric, interval.peak_abs_z
                ),
                service: Some(interval.service.clone()),
                time_ns: Some(interval.start_ns),
                strength: (interval.peak_abs_z / crate::baseline::Z_SATURATION).clamp(0.0, 1.0),
                source_refs: interval.source_refs.clone(),
            },
        );
        let deg = format!("deg:{}", interval.service);
        if node_ids.contains(&deg) {
            push_edge(
                &mut graph,
                &mut edge_seq,
                &id,
                &deg,
                EvidenceEdgeKind::ContributesTo,
                "metric anomaly contributes to degradation".into(),
            );
        }
    }

    // Top candidates + their changes, logs, propagation and contradictions.
    for scored in ranking.candidates.iter().take(top_n) {
        let f = &scored.features;
        let cand_id = format!("cand:{}", f.service);
        push_node(
            &mut graph,
            &mut node_ids,
            EvidenceGraphNode {
                id: cand_id.clone(),
                kind: EvidenceNodeKind::RootCauseCandidate,
                label: format!("#{} likely cause: {}", scored.rank, f.service),
                service: Some(f.service.clone()),
                time_ns: f.onset_ns,
                strength: scored.score.clamp(0.0, 1.0),
                source_refs: vec![],
            },
        );
        let deg_id = format!("deg:{}", f.service);
        if node_ids.contains(&deg_id) {
            push_edge(
                &mut graph,
                &mut edge_seq,
                &deg_id,
                &cand_id,
                EvidenceEdgeKind::ContributesTo,
                "degradation supports candidate".into(),
            );
        }

        for change_ref in &f.change_refs {
            let id = format!("change:{change_ref}");
            push_node(
                &mut graph,
                &mut node_ids,
                EvidenceGraphNode {
                    id: id.clone(),
                    kind: EvidenceNodeKind::Change,
                    label: format!("change on {}", f.service),
                    service: Some(f.service.clone()),
                    time_ns: None,
                    strength: f.change_proximity,
                    source_refs: vec![change_ref.clone()],
                },
            );
            if node_ids.contains(&deg_id) {
                push_edge(
                    &mut graph,
                    &mut edge_seq,
                    &id,
                    &deg_id,
                    EvidenceEdgeKind::Precedes,
                    "change precedes anomaly onset; associated, not proven".into(),
                );
            }
        }

        for log_ref in &f.log_refs {
            let id = format!("log:{log_ref}");
            push_node(
                &mut graph,
                &mut node_ids,
                EvidenceGraphNode {
                    id: id.clone(),
                    kind: EvidenceNodeKind::LogPattern,
                    label: format!("high-severity log on {}", f.service),
                    service: Some(f.service.clone()),
                    time_ns: None,
                    strength: f.log_evidence,
                    source_refs: vec![log_ref.clone()],
                },
            );
            if node_ids.contains(&deg_id) {
                push_edge(
                    &mut graph,
                    &mut edge_seq,
                    &id,
                    &deg_id,
                    EvidenceEdgeKind::CorrelatesWith,
                    "log correlates with degradation".into(),
                );
            }
        }

        // Dependency propagation: candidate degradation propagates to its
        // anomalous transitive callers, if the caller started later.
        for impacted in &f.impacted_anomalous {
            let to = format!("deg:{impacted}");
            if !node_ids.contains(&to) || !node_ids.contains(&deg_id) {
                continue;
            }
            let later = match (
                onsets.get(f.service.as_str()),
                onsets.get(impacted.as_str()),
            ) {
                (Some(own), Some(theirs)) => theirs >= own,
                _ => false,
            };
            if later {
                push_edge(
                    &mut graph,
                    &mut edge_seq,
                    &deg_id,
                    &to,
                    EvidenceEdgeKind::PropagatesTo,
                    format!("dependency path {} -> {}", f.service, impacted),
                );
            }
        }

        for preceding in &f.preceding_impacted {
            let from = format!("deg:{preceding}");
            if node_ids.contains(&from) {
                push_edge(
                    &mut graph,
                    &mut edge_seq,
                    &from,
                    &cand_id,
                    EvidenceEdgeKind::Contradicts,
                    format!("{preceding} degraded before {}", f.service),
                );
            }
        }
    }

    graph.nodes.sort_by(|a, b| a.id.cmp(&b.id));
    graph.edges.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then_with(|| a.to.cmp(&b.to))
            .then_with(|| a.id.cmp(&b.id))
    });
    graph
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::{compute_features, FeatureConfig};
    use crate::ranking::{rank_candidates, RankingWeights};

    // Reuse the features test scenario through the public pipeline: this
    // exercises graph construction on a realistic anomalous stream.
    fn scenario_graph() -> EvidenceGraph {
        let envs = crate::features::test_support::scenario();
        let features = compute_features(&envs, &FeatureConfig::default());
        let ranking = rank_candidates(&features, &RankingWeights::default());
        build_evidence_graph("inc-test", &features, &ranking, 3)
    }

    #[test]
    fn graph_has_candidate_degradation_and_change_chain() {
        let g = scenario_graph();
        assert!(g.nodes.iter().any(|n| n.id == "cand:backend"));
        assert!(g.nodes.iter().any(|n| n.id == "deg:backend"));
        assert!(g.nodes.iter().any(|n| n.kind == EvidenceNodeKind::Change));
        assert!(g
            .edges
            .iter()
            .any(|e| e.kind == EvidenceEdgeKind::Precedes && e.to == "deg:backend"));
        assert!(g
            .edges
            .iter()
            .any(|e| e.kind == EvidenceEdgeKind::PropagatesTo
                && e.from == "deg:backend"
                && e.to == "deg:frontend"));
        assert!(g
            .edges
            .iter()
            .any(|e| e.kind == EvidenceEdgeKind::ContributesTo && e.to == "cand:backend"));
    }

    #[test]
    fn graph_is_deterministic() {
        let a = serde_json::to_string(&scenario_graph()).unwrap();
        let b = serde_json::to_string(&scenario_graph()).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn edges_reference_existing_nodes() {
        let g = scenario_graph();
        let ids: BTreeSet<&str> = g.nodes.iter().map(|n| n.id.as_str()).collect();
        for e in &g.edges {
            assert!(ids.contains(e.from.as_str()), "dangling from {}", e.from);
            assert!(ids.contains(e.to.as_str()), "dangling to {}", e.to);
        }
    }
}
