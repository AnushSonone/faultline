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

/// Aggregate over incidents: top-1/top-3 accuracy, mean reciprocal rank, and
/// RCAEval's Avg@5.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvalSummary {
    pub incidents: usize,
    pub top1_accuracy: f64,
    pub top3_accuracy: f64,
    pub mrr: f64,
    /// RCAEval Avg@5: the mean over k = 1..=5 of AC@k, where AC@k is the
    /// fraction of incidents whose labeled root cause is within the top k
    /// (RCAEval 1.6.0 `benchmark/evaluation.py`, `Evaluator.average`).
    #[serde(default)]
    pub avg5: f64,
}

/// AC@k for one incident: 1 when a labeled root cause ranks within the top k.
pub fn hit_at(best_rank: Option<usize>, k: usize) -> bool {
    best_rank.is_some_and(|r| r <= k)
}

/// Avg@k for one incident: the mean over j = 1..=k of AC@j. Averaging this
/// over incidents equals RCAEval's `sum(AC@j for j in 1..=k) / k`.
pub fn avg_at(best_rank: Option<usize>, k: usize) -> f64 {
    if k == 0 {
        return 0.0;
    }
    (1..=k).filter(|j| hit_at(best_rank, *j)).count() as f64 / k as f64
}

pub fn summarize(evals: &[RankingEval]) -> EvalSummary {
    let n = evals.len();
    if n == 0 {
        return EvalSummary {
            incidents: 0,
            top1_accuracy: 0.0,
            top3_accuracy: 0.0,
            mrr: 0.0,
            avg5: 0.0,
        };
    }
    EvalSummary {
        incidents: n,
        top1_accuracy: evals.iter().filter(|e| e.top1).count() as f64 / n as f64,
        top3_accuracy: evals.iter().filter(|e| e.top3).count() as f64 / n as f64,
        mrr: evals.iter().map(|e| e.reciprocal_rank).sum::<f64>() / n as f64,
        avg5: evals.iter().map(|e| avg_at(e.best_rank, 5)).sum::<f64>() / n as f64,
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
        // Ranks 1 and 2: Avg@5 = ((5/5) + (4/5)) / 2.
        assert!((s.avg5 - 0.9).abs() < 1e-12);
    }

    #[test]
    fn avg_at_5_per_incident() {
        assert_eq!(avg_at(Some(1), 5), 1.0);
        assert!((avg_at(Some(2), 5) - 0.8).abs() < 1e-12);
        assert!((avg_at(Some(5), 5) - 0.2).abs() < 1e-12);
        assert_eq!(avg_at(Some(6), 5), 0.0);
        assert_eq!(avg_at(None, 5), 0.0);
    }

    #[test]
    fn avg_at_5_matches_rcaeval_definition() {
        // Hand-computed: best ranks 1, 2, 6, none.
        // AC@1 = 1/4, AC@2..AC@5 = 2/4, so Avg@5 = (0.25 + 4 * 0.5) / 5 = 0.45.
        let r = ranking(&[
            ("a", 0.9),
            ("b", 0.8),
            ("c", 0.7),
            ("d", 0.6),
            ("e", 0.5),
            ("f", 0.4),
        ]);
        let evals = vec![
            evaluate_ranking("i1", &r, &["a".into()]),
            evaluate_ranking("i2", &r, &["b".into()]),
            evaluate_ranking("i3", &r, &["f".into()]),
            evaluate_ranking("i4", &r, &["ghost".into()]),
        ];
        let rcaeval: f64 = (1..=5)
            .map(|k| evals.iter().filter(|e| hit_at(e.best_rank, k)).count() as f64 / 4.0)
            .sum::<f64>()
            / 5.0;
        let s = summarize(&evals);
        assert!((s.avg5 - 0.45).abs() < 1e-12);
        assert!((s.avg5 - rcaeval).abs() < 1e-12);
    }
}
