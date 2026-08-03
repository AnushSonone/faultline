//! Root-cause ranking with score decomposition (TA-032, spec 18.4).
//!
//! One score implementation for both backend output and evaluation. Feature
//! values and weighted contributions are stored separately so every component
//! is inspectable, and negative evidence is never hidden.

use serde::{Deserialize, Serialize};

use crate::features::{CandidateFeatures, FeatureSet};

/// Score component identifiers, in fixed spec order.
pub const COMPONENTS: [&str; 9] = [
    "anomaly_strength",
    "temporal_precedence",
    "failed_trace_coverage",
    "critical_path_contribution",
    "downstream_impact",
    "topology_consistency",
    "change_proximity",
    "log_evidence",
    "contradiction_penalty",
];

/// Weights per spec 18.4. A starting hypothesis, not a tuned optimum; tuning
/// happens only on a training split (TA-048) and both results get reported.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct RankingWeights {
    pub anomaly_strength: f64,
    pub temporal_precedence: f64,
    pub failed_trace_coverage: f64,
    pub critical_path_contribution: f64,
    pub downstream_impact: f64,
    pub topology_consistency: f64,
    pub change_proximity: f64,
    pub log_evidence: f64,
    /// Applied negatively.
    pub contradiction_penalty: f64,
}

impl Default for RankingWeights {
    fn default() -> Self {
        Self {
            anomaly_strength: 0.20,
            temporal_precedence: 0.15,
            failed_trace_coverage: 0.15,
            critical_path_contribution: 0.15,
            downstream_impact: 0.10,
            topology_consistency: 0.10,
            change_proximity: 0.10,
            log_evidence: 0.05,
            contradiction_penalty: 0.10,
        }
    }
}

/// One inspectable component of a candidate's score.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScoreComponent {
    pub name: String,
    /// Normalized feature value in [0, 1].
    pub feature_value: f64,
    pub weight: f64,
    /// `weight * feature_value`, negated for the contradiction penalty.
    pub contribution: f64,
}

/// A ranked candidate with its full decomposition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScoredCandidate {
    pub rank: usize,
    pub service: String,
    pub score: f64,
    pub components: Vec<ScoreComponent>,
    pub features: CandidateFeatures,
}

/// Full ranking output for an incident.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Ranking {
    pub weights: RankingWeights,
    pub candidates: Vec<ScoredCandidate>,
}

/// Score one candidate. The single scoring path used everywhere.
pub fn score_candidate(features: &CandidateFeatures, weights: &RankingWeights) -> ScoredCandidate {
    let raw = [
        (
            "anomaly_strength",
            features.anomaly_strength,
            weights.anomaly_strength,
            1.0,
        ),
        (
            "temporal_precedence",
            features.temporal_precedence,
            weights.temporal_precedence,
            1.0,
        ),
        (
            "failed_trace_coverage",
            features.failed_trace_coverage,
            weights.failed_trace_coverage,
            1.0,
        ),
        (
            "critical_path_contribution",
            features.critical_path_contribution,
            weights.critical_path_contribution,
            1.0,
        ),
        (
            "downstream_impact",
            features.downstream_impact,
            weights.downstream_impact,
            1.0,
        ),
        (
            "topology_consistency",
            features.topology_consistency,
            weights.topology_consistency,
            1.0,
        ),
        (
            "change_proximity",
            features.change_proximity,
            weights.change_proximity,
            1.0,
        ),
        (
            "log_evidence",
            features.log_evidence,
            weights.log_evidence,
            1.0,
        ),
        (
            "contradiction_penalty",
            features.contradiction_penalty,
            weights.contradiction_penalty,
            -1.0,
        ),
    ];
    let components: Vec<ScoreComponent> = raw
        .into_iter()
        .map(|(name, value, weight, sign)| ScoreComponent {
            name: name.to_owned(),
            feature_value: value,
            weight,
            contribution: sign * weight * value,
        })
        .collect();
    let score = components.iter().map(|c| c.contribution).sum();
    ScoredCandidate {
        rank: 0,
        service: features.service.clone(),
        score,
        components,
        features: features.clone(),
    }
}

/// Rank every candidate in a feature set. Deterministic: sorted by score
/// descending, ties broken by service name ascending. Ranks are 1-based.
pub fn rank_candidates(set: &FeatureSet, weights: &RankingWeights) -> Ranking {
    let mut candidates: Vec<ScoredCandidate> = set
        .candidates
        .iter()
        .map(|f| score_candidate(f, weights))
        .collect();
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .expect("scores are finite")
            .then_with(|| a.service.cmp(&b.service))
    });
    for (i, c) in candidates.iter_mut().enumerate() {
        c.rank = i + 1;
    }
    Ranking {
        weights: *weights,
        candidates,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn features(service: &str) -> CandidateFeatures {
        CandidateFeatures {
            service: service.into(),
            anomaly_strength: 0.0,
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

    #[test]
    fn max_features_hit_spec_ceiling() {
        let mut f = features("a");
        f.anomaly_strength = 1.0;
        f.temporal_precedence = 1.0;
        f.failed_trace_coverage = 1.0;
        f.critical_path_contribution = 1.0;
        f.downstream_impact = 1.0;
        f.topology_consistency = 1.0;
        f.change_proximity = 1.0;
        f.log_evidence = 1.0;
        let scored = score_candidate(&f, &RankingWeights::default());
        assert!((scored.score - 1.0).abs() < 1e-12);
        f.contradiction_penalty = 1.0;
        let scored = score_candidate(&f, &RankingWeights::default());
        assert!((scored.score - 0.9).abs() < 1e-12);
    }

    #[test]
    fn contradiction_contribution_is_negative_and_visible() {
        let mut f = features("a");
        f.contradiction_penalty = 0.5;
        let scored = score_candidate(&f, &RankingWeights::default());
        let comp = scored
            .components
            .iter()
            .find(|c| c.name == "contradiction_penalty")
            .unwrap();
        assert_eq!(comp.feature_value, 0.5);
        assert!((comp.contribution + 0.05).abs() < 1e-12);
        assert!(scored.score < 0.0);
    }

    #[test]
    fn contributions_sum_to_score() {
        let mut f = features("a");
        f.anomaly_strength = 0.7;
        f.change_proximity = 0.3;
        f.contradiction_penalty = 0.2;
        let scored = score_candidate(&f, &RankingWeights::default());
        let sum: f64 = scored.components.iter().map(|c| c.contribution).sum();
        assert!((sum - scored.score).abs() < 1e-12);
        assert_eq!(scored.components.len(), COMPONENTS.len());
    }

    #[test]
    fn ranking_is_deterministic_with_name_tiebreak() {
        let set = FeatureSet {
            candidates: vec![features("zeta"), features("alpha"), features("mid")],
            anomaly_intervals: vec![],
            incident_onset_ns: None,
            incident_end_ns: None,
        };
        let ranking = rank_candidates(&set, &RankingWeights::default());
        let names: Vec<&str> = ranking
            .candidates
            .iter()
            .map(|c| c.service.as_str())
            .collect();
        // All scores tie at 0.0: alphabetical order, 1-based ranks.
        assert_eq!(names, vec!["alpha", "mid", "zeta"]);
        assert_eq!(ranking.candidates[0].rank, 1);
        assert_eq!(ranking.candidates[2].rank, 3);
    }
}
