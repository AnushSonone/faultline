//! RCA evaluation suite (TA-048, spec 26.1).
//!
//! Pipeline runs blind per incident; labels enter only after ranking.
//! Reports top-1/top-3/MRR overall and per fault type, plus ablations
//! (zero one component's weight, re-rank, re-score).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use faultline_inference::eval::{evaluate_ranking, summarize, EvalSummary, RankingEval};
use faultline_inference::features::{compute_features, FeatureConfig};
use faultline_inference::ranking::{rank_candidates, RankingWeights};
use faultline_replay::load_incident;
use serde::{Deserialize, Serialize};

/// Spec 26.1 ablations: component name -> weights with that component zeroed.
fn ablations() -> Vec<(&'static str, RankingWeights)> {
    let base = RankingWeights::default;
    vec![
        (
            "no_temporal_precedence",
            RankingWeights {
                temporal_precedence: 0.0,
                ..base()
            },
        ),
        (
            "no_failed_trace_coverage",
            RankingWeights {
                failed_trace_coverage: 0.0,
                ..base()
            },
        ),
        (
            "no_topology",
            RankingWeights {
                topology_consistency: 0.0,
                downstream_impact: 0.0,
                ..base()
            },
        ),
        (
            "no_change_proximity",
            RankingWeights {
                change_proximity: 0.0,
                ..base()
            },
        ),
        (
            "no_log_evidence",
            RankingWeights {
                log_evidence: 0.0,
                ..base()
            },
        ),
        (
            "no_critical_path",
            RankingWeights {
                critical_path_contribution: 0.0,
                ..base()
            },
        ),
    ]
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IncidentOutcome {
    pub incident_id: String,
    pub fault_type: String,
    pub eval: RankingEval,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EvaluationReport {
    /// Untuned spec 18.4 weights - the primary, train-free result.
    pub untuned: EvalSummary,
    pub per_fault_type: BTreeMap<String, EvalSummary>,
    pub ablations: BTreeMap<String, EvalSummary>,
    pub incidents: Vec<IncidentOutcome>,
    /// (predicted_top1, labeled) pairs for misranked incidents.
    pub confusion: Vec<(String, String)>,
    pub dataset: String,
    pub incident_count: usize,
}

/// Incident directories matching `prefix` under `<fixtures>/<dataset>`.
pub fn discover_incidents_in(fixtures_root: &Path, dataset: &str, prefix: &str) -> Vec<PathBuf> {
    let base = fixtures_root.join(dataset);
    let mut dirs: Vec<PathBuf> = faultline_catalog::discover_incidents(fixtures_root)
        .into_iter()
        .filter(|i| i.path.starts_with(&base) && i.incident_id.starts_with(prefix))
        .map(|i| i.path)
        .collect();
    dirs.sort();
    dirs
}

/// Evaluate with the synthetic-dataset label.
pub fn evaluate_suite(incident_dirs: &[PathBuf]) -> Result<EvaluationReport, String> {
    evaluate_suite_labeled(incident_dirs, "synthetic-ob/v1 (synthetic; NOT RCAEval)")
}

/// Back-compat: the synthetic suite location.
pub fn discover_incidents(fixtures_root: &Path, prefix: &str) -> Vec<PathBuf> {
    discover_incidents_in(fixtures_root, "synthetic-ob/v1", prefix)
}

pub fn evaluate_suite_labeled(
    incident_dirs: &[PathBuf],
    dataset_label: &str,
) -> Result<EvaluationReport, String> {
    let mut outcomes: Vec<IncidentOutcome> = Vec::new();
    let mut ablation_evals: BTreeMap<String, Vec<RankingEval>> = BTreeMap::new();

    for dir in incident_dirs {
        let incident = load_incident(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        // Blind pipeline: labels are not consulted until evaluate_ranking.
        let features = compute_features(&incident.envelopes, &FeatureConfig::default());
        let ranking = rank_candidates(&features, &RankingWeights::default());
        let eval = evaluate_ranking(
            &incident.labels.incident_id,
            &ranking,
            &incident.labels.root_cause_services,
        );
        outcomes.push(IncidentOutcome {
            incident_id: incident.labels.incident_id.clone(),
            fault_type: incident.labels.fault_type.clone(),
            eval,
        });
        for (name, weights) in ablations() {
            let ranking = rank_candidates(&features, &weights);
            let eval = evaluate_ranking(
                &incident.labels.incident_id,
                &ranking,
                &incident.labels.root_cause_services,
            );
            ablation_evals
                .entry(name.to_owned())
                .or_default()
                .push(eval);
        }
    }

    let untuned = summarize(&outcomes.iter().map(|o| o.eval.clone()).collect::<Vec<_>>());
    let mut per_fault: BTreeMap<String, Vec<RankingEval>> = BTreeMap::new();
    for o in &outcomes {
        per_fault
            .entry(o.fault_type.clone())
            .or_default()
            .push(o.eval.clone());
    }
    let confusion = outcomes
        .iter()
        .filter(|o| !o.eval.top1)
        .map(|o| {
            (
                o.eval.ranked_services.first().cloned().unwrap_or_default(),
                o.eval.labeled_services.first().cloned().unwrap_or_default(),
            )
        })
        .collect();

    Ok(EvaluationReport {
        untuned,
        per_fault_type: per_fault
            .into_iter()
            .map(|(k, v)| (k, summarize(&v)))
            .collect(),
        ablations: ablation_evals
            .into_iter()
            .map(|(k, v)| (k, summarize(&v)))
            .collect(),
        incident_count: incident_dirs.len(),
        incidents: outcomes,
        confusion,
        dataset: dataset_label.to_owned(),
    })
}

pub fn render_markdown(report: &EvaluationReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# RCA evaluation ({} incidents, {})\n\nUntuned spec 18.4 weights (train-free):\n\n",
        report.incident_count, report.dataset
    ));
    out.push_str("| metric | value |\n|---|---|\n");
    out.push_str(&format!(
        "| top-1 accuracy | {:.3} |\n",
        report.untuned.top1_accuracy
    ));
    out.push_str(&format!(
        "| top-3 accuracy | {:.3} |\n",
        report.untuned.top3_accuracy
    ));
    out.push_str(&format!("| MRR | {:.3} |\n\n", report.untuned.mrr));
    out.push_str(
        "## Per fault type\n\n| fault | top-1 | top-3 | MRR | n |\n|---|---|---|---|---|\n",
    );
    for (fault, s) in &report.per_fault_type {
        out.push_str(&format!(
            "| {fault} | {:.3} | {:.3} | {:.3} | {} |\n",
            s.top1_accuracy, s.top3_accuracy, s.mrr, s.incidents
        ));
    }
    out.push_str("\n## Ablations (component removed)\n\n| ablation | top-1 | top-3 | MRR |\n|---|---|---|---|\n");
    for (name, s) in &report.ablations {
        out.push_str(&format!(
            "| {name} | {:.3} | {:.3} | {:.3} |\n",
            s.top1_accuracy, s.top3_accuracy, s.mrr
        ));
    }
    if !report.confusion.is_empty() {
        out.push_str("\n## Confusion (predicted -> labeled)\n\n");
        for (pred, label) in &report.confusion {
            out.push_str(&format!("- {pred} -> {label}\n"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../datasets/fixtures")
    }

    #[test]
    fn evaluates_suite_deterministically() {
        let dirs = discover_incidents(&fixtures_root(), "eval-");
        if dirs.is_empty() {
            return; // suite not generated on this machine
        }
        let a = evaluate_suite(&dirs).unwrap();
        let b = evaluate_suite(&dirs).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        assert_eq!(a.incident_count, dirs.len());
        // Honest floor, not a vanity target: the pipeline must beat random
        // top-1 (1/6 services) on the synthetic suite by a wide margin.
        assert!(
            a.untuned.top1_accuracy >= 0.5,
            "top1 collapsed: {:?}",
            a.untuned
        );
    }

    #[test]
    fn single_fixture_stays_top1() {
        let dir = fixtures_root().join("synthetic-ob/v1/rec-mem-001");
        if !dir.exists() {
            return;
        }
        let report = evaluate_suite(&[dir]).unwrap();
        assert_eq!(report.untuned.top1_accuracy, 1.0);
    }
}
