//! Ranking evaluation metrics (M4 initial evaluation; grows into TA-048).
//!
//! Ground truth enters the system only here, as an explicit argument, after a
//! ranking has already been produced. The inference pipeline itself never
//! sees labels.

use serde::{Deserialize, Serialize};

use crate::ranking::Ranking;

/// Metrics for one incident's ranking against labeled root causes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RankingEval {
    pub incident_id: String,
    pub top1: bool,
    pub top3: bool,
    /// Reciprocal of the best rank of any labeled root cause; 0 when no
    /// labeled service appears in the ranking.
    pub reciprocal_rank: f64,
    /// Best (lowest) rank of a labeled root cause, if present.
    pub best_rank: Option<usize>,
    pub labeled_services: Vec<String>,
    pub ranked_services: Vec<String>,
}

/// Evaluate one ranking against the labeled root-cause services.
pub fn evaluate_ranking(
    incident_id: &str,
    ranking: &Ranking,
    root_cause_services: &[String],
) -> RankingEval {
    let best_rank = ranking
        .candidates
        .iter()
        .filter(|c| root_cause_services.contains(&c.service))
        .map(|c| c.rank)
        .min();
    RankingEval {
        incident_id: incident_id.to_owned(),
        top1: best_rank == Some(1),
        top3: best_rank.is_some_and(|r| r <= 3),
        reciprocal_rank: best_rank.map(|r| 1.0 / r as f64).unwrap_or(0.0),
        best_rank,
        labeled_services: root_cause_services.to_vec(),
        ranked_services: ranking
            .candidates
            .iter()
            .map(|c| c.service.clone())
            .collect(),
    }
}

/// Aggregate over incidents: top-1/top-3 accuracy and mean reciprocal rank.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvalSummary {
    pub incidents: usize,
    pub top1_accuracy: f64,
    pub top3_accuracy: f64,
    pub mrr: f64,
}

pub fn summarize(evals: &[RankingEval]) -> EvalSummary {
    let n = evals.len();
    if n == 0 {
        return EvalSummary {
            incidents: 0,
            top1_accuracy: 0.0,
            top3_accuracy: 0.0,
            mrr: 0.0,
        };
    }
    EvalSummary {
        incidents: n,
        top1_accuracy: evals.iter().filter(|e| e.top1).count() as f64 / n as f64,
        top3_accuracy: evals.iter().filter(|e| e.top3).count() as f64 / n as f64,
        mrr: evals.iter().map(|e| e.reciprocal_rank).sum::<f64>() / n as f64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::{CandidateFeatures, FeatureSet};
    use crate::ranking::{rank_candidates, RankingWeights};

    fn candidate(service: &str, strength: f64) -> CandidateFeatures {
        CandidateFeatures {
            service: service.into(),
            anomaly_strength: strength,
            temporal_precedence: 0.0,
            failed_trace_coverage: 0.0,
            critical_path_contribution: 0.0,
            downstream_impact: 0.0,
            topology_consistency: 0.0,
            change_proximity: 0.0,
            log_evidence: 0.0,
            persistence: 0.0,
            contradiction_penalty: 0.0,
            onset_ns: None,
            peak_abs_z: 0.0,
            anomaly_refs: vec![],
            change_refs: vec![],
            log_refs: vec![],
            failed_trace_ids: vec![],
            impacted_anomalous: vec![],
            preceding_impacted: vec![],
        }
    }

    fn ranking(order: &[(&str, f64)]) -> Ranking {
        let set = FeatureSet {
            candidates: order.iter().map(|(s, v)| candidate(s, *v)).collect(),
            anomaly_intervals: vec![],
            incident_onset_ns: None,
            incident_end_ns: None,
        };
        rank_candidates(&set, &RankingWeights::default())
    }

    #[test]
    fn top1_hit() {
        let r = ranking(&[("a", 0.9), ("b", 0.5), ("c", 0.1)]);
        let e = evaluate_ranking("i", &r, &["a".into()]);
        assert!(e.top1 && e.top3);
        assert_eq!(e.reciprocal_rank, 1.0);
    }

    #[test]
    fn rank_two_is_top3_not_top1() {
        let r = ranking(&[("a", 0.9), ("b", 0.5), ("c", 0.1)]);
        let e = evaluate_ranking("i", &r, &["b".into()]);
        assert!(!e.top1 && e.top3);
        assert_eq!(e.reciprocal_rank, 0.5);
        assert_eq!(e.best_rank, Some(2));
    }

    #[test]
    fn missing_label_scores_zero() {
        let r = ranking(&[("a", 0.9)]);
        let e = evaluate_ranking("i", &r, &["ghost".into()]);
        assert!(!e.top1 && !e.top3);
        assert_eq!(e.reciprocal_rank, 0.0);
        assert_eq!(e.best_rank, None);
    }

    #[test]
    fn summary_aggregates() {
        let r1 = ranking(&[("a", 0.9), ("b", 0.5)]);
        let e1 = evaluate_ranking("i1", &r1, &["a".into()]);
        let e2 = evaluate_ranking("i2", &r1, &["b".into()]);
        let s = summarize(&[e1, e2]);
        assert_eq!(s.incidents, 2);
        assert_eq!(s.top1_accuracy, 0.5);
        assert_eq!(s.top3_accuracy, 1.0);
        assert!((s.mrr - 0.75).abs() < 1e-12);
    }
}
