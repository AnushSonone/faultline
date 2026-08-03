//! Evidence objects (TA-033, spec 18.5).
//!
//! Every evidence item ties a score component back to concrete telemetry via
//! `source_refs` (event ids or trace ids), carries a direction (supports or
//! contradicts), and uses claim-disciplined language: "associated", "precedes",
//! "consistent with" - never proven causation. Contradicting evidence is
//! always emitted, never hidden.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::features::{CandidateFeatures, FeatureSet};
use crate::ranking::Ranking;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    MetricAnomaly,
    FailedTraceCoverage,
    CriticalPathIncrease,
    TemporalPrecedence,
    DeploymentProximity,
    LogTemplateSpike,
    DependencyPropagation,
    Contradiction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceDirection {
    Supports,
    Contradicts,
}

/// Spec 18.5 evidence object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    /// Deterministic id: sha256 over (incident, candidate, type, range).
    pub evidence_id: String,
    pub incident_id: String,
    pub candidate_service: String,
    #[serde(rename = "type")]
    pub evidence_type: EvidenceType,
    pub event_time_range: (i64, i64),
    /// Normalized strength in [0, 1] - the feature value that produced it.
    pub strength: f64,
    pub direction: EvidenceDirection,
    pub source_refs: Vec<String>,
    pub human_label: String,
    /// Structured detail for the UI drill-down.
    pub details: serde_json::Value,
}

fn evidence_id(
    incident_id: &str,
    candidate: &str,
    evidence_type: EvidenceType,
    range: (i64, i64),
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(incident_id.as_bytes());
    hasher.update(b"|");
    hasher.update(candidate.as_bytes());
    hasher.update(b"|");
    hasher.update(format!("{evidence_type:?}").as_bytes());
    hasher.update(b"|");
    hasher.update(range.0.to_le_bytes());
    hasher.update(range.1.to_le_bytes());
    let digest = hasher.finalize();
    format!("ev-{}", &hex::encode(digest)[..16])
}

/// Build evidence for one candidate from its feature vector. Only features
/// with signal (> 0) produce evidence; the contradiction features always
/// produce evidence when present.
pub fn evidence_for_candidate(
    incident_id: &str,
    features: &CandidateFeatures,
    incident_onset_ns: Option<i64>,
    incident_end_ns: Option<i64>,
) -> Vec<Evidence> {
    let mut out = Vec::new();
    let onset = features.onset_ns.or(incident_onset_ns).unwrap_or(0);
    let end = incident_end_ns.unwrap_or(onset);
    let mk = |etype: EvidenceType,
              strength: f64,
              direction: EvidenceDirection,
              range: (i64, i64),
              refs: Vec<String>,
              label: String,
              details: serde_json::Value| Evidence {
        evidence_id: evidence_id(incident_id, &features.service, etype, range),
        incident_id: incident_id.to_owned(),
        candidate_service: features.service.clone(),
        evidence_type: etype,
        event_time_range: range,
        strength,
        direction,
        source_refs: refs,
        human_label: label,
        details,
    };

    if features.anomaly_strength > 0.0 {
        out.push(mk(
            EvidenceType::MetricAnomaly,
            features.anomaly_strength,
            EvidenceDirection::Supports,
            (onset, end),
            features.anomaly_refs.clone(),
            format!(
                "{} metrics deviate from their rolling baseline (peak robust z {:.1})",
                features.service, features.peak_abs_z
            ),
            serde_json::json!({
                "peak_abs_z": features.peak_abs_z,
                "persistence": features.persistence,
            }),
        ));
    }

    if features.temporal_precedence > 0.0 && features.onset_ns.is_some() {
        out.push(mk(
            EvidenceType::TemporalPrecedence,
            features.temporal_precedence,
            EvidenceDirection::Supports,
            (onset, onset),
            vec![],
            format!(
                "{} became anomalous early in the incident, before most affected services",
                features.service
            ),
            serde_json::json!({ "onset_ns": features.onset_ns }),
        ));
    }

    if features.failed_trace_coverage > 0.0 {
        out.push(mk(
            EvidenceType::FailedTraceCoverage,
            features.failed_trace_coverage,
            EvidenceDirection::Supports,
            (onset, end),
            features.failed_trace_ids.clone(),
            format!(
                "{} appears in {:.0}% of failed traces",
                features.service,
                features.failed_trace_coverage * 100.0
            ),
            serde_json::json!({ "failed_trace_count": features.failed_trace_ids.len() }),
        ));
    }

    if features.critical_path_contribution > 0.0 {
        out.push(mk(
            EvidenceType::CriticalPathIncrease,
            features.critical_path_contribution,
            EvidenceDirection::Supports,
            (onset, end),
            features.failed_trace_ids.clone(),
            format!(
                "{} accounts for {:.0}% of excess critical-path time in failed traces",
                features.service,
                features.critical_path_contribution * 100.0
            ),
            serde_json::json!({ "method": "critical_path_attribution_ta035" }),
        ));
    }

    if features.topology_consistency > 0.0 || features.downstream_impact > 0.0 {
        out.push(mk(
            EvidenceType::DependencyPropagation,
            features
                .topology_consistency
                .max(features.downstream_impact),
            EvidenceDirection::Supports,
            (onset, end),
            vec![],
            format!(
                "anomalous services {} are dependency-connected callers of {}",
                features.impacted_anomalous.join(", "),
                features.service
            ),
            serde_json::json!({
                "impacted_anomalous": features.impacted_anomalous,
                "downstream_impact": features.downstream_impact,
                "topology_consistency": features.topology_consistency,
            }),
        ));
    }

    if features.change_proximity > 0.0 {
        out.push(mk(
            EvidenceType::DeploymentProximity,
            features.change_proximity,
            EvidenceDirection::Supports,
            (onset, onset),
            features.change_refs.clone(),
            format!(
                "a change on {} shortly precedes its anomaly onset; associated, not proven causation",
                features.service
            ),
            serde_json::json!({ "change_refs": features.change_refs }),
        ));
    }

    if features.log_evidence > 0.0 {
        out.push(mk(
            EvidenceType::LogTemplateSpike,
            features.log_evidence,
            EvidenceDirection::Supports,
            (onset, end),
            features.log_refs.clone(),
            format!(
                "high-severity logs on {} near anomaly onset",
                features.service
            ),
            serde_json::json!({ "log_count": features.log_refs.len() }),
        ));
    }

    if features.contradiction_penalty > 0.0 {
        let label = if features.onset_ns.is_none() {
            format!(
                "{} never became anomalous while other services did; weakens it as a cause",
                features.service
            )
        } else {
            format!(
                "impacted services {} became anomalous before {}; contradicts it causing them",
                features.preceding_impacted.join(", "),
                features.service
            )
        };
        out.push(mk(
            EvidenceType::Contradiction,
            features.contradiction_penalty,
            EvidenceDirection::Contradicts,
            (onset, end),
            vec![],
            label,
            serde_json::json!({ "preceding_impacted": features.preceding_impacted }),
        ));
    }

    out
}

/// Evidence for every ranked candidate, in rank order.
pub fn evidence_for_ranking(
    incident_id: &str,
    set: &FeatureSet,
    ranking: &Ranking,
) -> Vec<Evidence> {
    let mut out = Vec::new();
    for candidate in &ranking.candidates {
        out.extend(evidence_for_candidate(
            incident_id,
            &candidate.features,
            set.incident_onset_ns,
            set.incident_end_ns,
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::CandidateFeatures;

    fn features() -> CandidateFeatures {
        CandidateFeatures {
            service: "backend".into(),
            anomaly_strength: 0.8,
            temporal_precedence: 1.0,
            failed_trace_coverage: 0.5,
            critical_path_contribution: 0.6,
            downstream_impact: 0.25,
            topology_consistency: 1.0,
            change_proximity: 0.9,
            log_evidence: 0.33,
            persistence: 0.7,
            contradiction_penalty: 0.0,
            onset_ns: Some(1_000),
            peak_abs_z: 6.4,
            anomaly_refs: vec!["m1".into()],
            change_refs: vec!["ch1".into()],
            log_refs: vec!["lg1".into()],
            failed_trace_ids: vec!["tr1".into()],
            impacted_anomalous: vec!["frontend".into()],
            preceding_impacted: vec![],
        }
    }

    #[test]
    fn supporting_evidence_carries_source_refs() {
        let evs = evidence_for_candidate("inc-1", &features(), Some(1_000), Some(9_000));
        assert!(!evs.is_empty());
        let metric = evs
            .iter()
            .find(|e| e.evidence_type == EvidenceType::MetricAnomaly)
            .unwrap();
        assert_eq!(metric.source_refs, vec!["m1".to_owned()]);
        assert_eq!(metric.direction, EvidenceDirection::Supports);
        assert!(metric.strength > 0.0);
        let deploy = evs
            .iter()
            .find(|e| e.evidence_type == EvidenceType::DeploymentProximity)
            .unwrap();
        assert_eq!(deploy.source_refs, vec!["ch1".to_owned()]);
        assert!(deploy.human_label.contains("not proven causation"));
    }

    #[test]
    fn contradiction_is_emitted_and_marked() {
        let mut f = features();
        f.contradiction_penalty = 0.5;
        f.preceding_impacted = vec!["frontend".into()];
        let evs = evidence_for_candidate("inc-1", &f, Some(1_000), Some(9_000));
        let contra = evs
            .iter()
            .find(|e| e.evidence_type == EvidenceType::Contradiction)
            .unwrap();
        assert_eq!(contra.direction, EvidenceDirection::Contradicts);
        assert!(contra.human_label.contains("frontend"));
    }

    #[test]
    fn zero_signal_produces_no_evidence() {
        let f = CandidateFeatures {
            service: "idle".into(),
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
        };
        assert!(evidence_for_candidate("inc-1", &f, None, None).is_empty());
    }

    #[test]
    fn evidence_ids_are_deterministic_and_distinct() {
        let a = evidence_for_candidate("inc-1", &features(), Some(1_000), Some(9_000));
        let b = evidence_for_candidate("inc-1", &features(), Some(1_000), Some(9_000));
        let ids_a: Vec<&str> = a.iter().map(|e| e.evidence_id.as_str()).collect();
        let ids_b: Vec<&str> = b.iter().map(|e| e.evidence_id.as_str()).collect();
        assert_eq!(ids_a, ids_b);
        let mut dedup = ids_a.clone();
        dedup.sort_unstable();
        dedup.dedup();
        assert_eq!(dedup.len(), ids_a.len());
    }
}
