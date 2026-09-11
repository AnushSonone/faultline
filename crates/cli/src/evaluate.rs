//! RCA evaluation suite (TA-048, spec 26.1).
//!
//! Pipeline runs blind per incident; labels enter only after ranking.
//! Reports top-1/top-3/MRR/Avg@5 overall and per fault type, plus ablations
//! (zero one component's weight, re-rank, re-score), a protocol block that
//! pins exactly what was measured, and per-incident onset diagnostics.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use faultline_inference::eval::{evaluate_ranking, summarize, EvalSummary, RankingEval};
use faultline_inference::features::{compute_features, FeatureConfig, FeatureSet};
use faultline_inference::ranking::{rank_candidates, RankingWeights};
use faultline_replay::load_incident;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Preset used when `--detector` is not given. After the detector fix merges
/// this becomes `v2` (see [`detector_config`]).
pub const DEFAULT_DETECTOR: &str = "v2";

/// Every preset name the harness knows about, in reporting order.
pub const KNOWN_DETECTORS: &[&str] = &[
    "legacy",
    "v2",
    "v2-no-floor",
    "v2-no-persistence",
    "v2-window32",
];

/// The one place a detector preset name becomes a `FeatureConfig`.
///
/// Kept isolated on purpose. `legacy` is the 2026-08-03 detector that produced
/// `benchmarks/rcaeval-eval.json`; `v2` is the spread-floor and persistence
/// detector and the build default; the other three revert one element of v2
/// each and are exploratory ablations, never used to choose settings.
pub fn detector_config(name: &str) -> Result<FeatureConfig, String> {
    match name {
        "legacy" => Ok(FeatureConfig::legacy()),
        "v2" => Ok(FeatureConfig::v2()),
        "v2-no-floor" => Ok(FeatureConfig::v2_no_floor()),
        "v2-no-persistence" => Ok(FeatureConfig::v2_no_persistence()),
        "v2-window32" => Ok(FeatureConfig::v2_window32()),
        other => Err(format!(
            "unknown detector preset '{other}' (known: {})",
            KNOWN_DETECTORS.join(", ")
        )),
    }
}

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

/// What exactly was measured. Everything here is deterministic for a given
/// commit, preset, and fixture set (no timestamps).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Protocol {
    /// Detector preset name passed to `--detector`.
    pub detector: String,
    /// The preset's `FeatureConfig`. `FeatureConfig` derives `Serialize`, so
    /// this is its full serde_json form.
    pub feature_config: serde_json::Value,
    /// sha256 of `canonical_json(feature_config)` (object keys sorted, no
    /// whitespace).
    pub feature_config_sha256: String,
    pub ranking_weights: serde_json::Value,
    /// sha256 of `canonical_json(RankingWeights::default())`.
    pub ranking_weights_sha256: String,
    pub canonical_serialization: String,
    /// Dataset path under the fixtures root, e.g. `rcaeval-re2-ob/v2`.
    pub dataset_path: String,
    pub incident_ids: Vec<String>,
    /// sha256 of each incident's manifest.json (pins every parquet file);
    /// comparable with `manifest_sha256` in the split manifest.
    pub incident_manifest_sha256: BTreeMap<String, String>,
    /// `git rev-parse HEAD` of the source tree this binary was built from.
    pub git_commit: Option<String>,
    /// `git status --porcelain` line count limited to [`GIT_DIRTY_SCOPE`], the
    /// paths that can change a result. Benchmark outputs are excluded so a
    /// re-run does not count its own previous outputs.
    pub git_dirty_files: Option<usize>,
    pub git_dirty_scope: String,
}

pub const GIT_DIRTY_SCOPE: &[&str] = &[
    "crates",
    "apps",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
];

/// When each service's detector onset fired relative to the labeled fault
/// start. Offsets are seconds, negative means before the injection.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OnsetReport {
    pub incident_onset_ns: Option<i64>,
    /// `fault_start_time_ns` from labels.json (RCAEval inject_time).
    pub fault_start_ns: i64,
    pub incident_onset_offset_s: Option<f64>,
    /// Services with a detector onset, keyed by service.
    pub service_onset_offset_s: BTreeMap<String, f64>,
    pub services_with_onset: usize,
    pub services_onset_before_fault: usize,
    /// Earliest onset among the labeled root-cause services.
    pub root_cause_onset_offset_s: Option<f64>,
    /// The labeled root cause's onset is earlier than every other service's.
    pub root_cause_strictly_earliest: bool,
    /// The labeled root cause shares the earliest onset with another service.
    pub root_cause_tied_earliest: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IncidentOutcome {
    pub incident_id: String,
    pub fault_type: String,
    pub eval: RankingEval,
    pub onsets: OnsetReport,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EvaluationReport {
    pub protocol: Protocol,
    /// Spec 18.4 ranking weights over the chosen detector preset.
    pub overall: EvalSummary,
    pub per_fault_type: BTreeMap<String, EvalSummary>,
    pub ablations: BTreeMap<String, EvalSummary>,
    pub incidents: Vec<IncidentOutcome>,
    /// (predicted_top1, labeled) pairs for misranked incidents.
    pub confusion: Vec<(String, String)>,
    pub dataset: String,
    pub incident_count: usize,
}

#[derive(Clone, Debug)]
pub struct EvaluateOptions {
    pub detector: String,
    /// Dataset path under the fixtures root (recorded in the protocol).
    pub dataset_path: String,
    /// Human label for the report header.
    pub dataset_label: String,
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

/// Back-compat: default detector, dataset path taken from the label.
pub fn evaluate_suite_labeled(
    incident_dirs: &[PathBuf],
    dataset_label: &str,
) -> Result<EvaluationReport, String> {
    evaluate(
        incident_dirs,
        &EvaluateOptions {
            detector: DEFAULT_DETECTOR.to_owned(),
            dataset_path: dataset_label
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned(),
            dataset_label: dataset_label.to_owned(),
        },
    )
}

pub fn evaluate(
    incident_dirs: &[PathBuf],
    opts: &EvaluateOptions,
) -> Result<EvaluationReport, String> {
    let config = detector_config(&opts.detector)?;
    let mut outcomes: Vec<IncidentOutcome> = Vec::new();
    let mut ablation_evals: BTreeMap<String, Vec<RankingEval>> = BTreeMap::new();
    let mut manifest_sha = BTreeMap::new();

    for dir in incident_dirs {
        let incident = load_incident(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let manifest_bytes = std::fs::read(dir.join("manifest.json"))
            .map_err(|e| format!("{}: {e}", dir.display()))?;
        manifest_sha.insert(
            incident.labels.incident_id.clone(),
            sha256_hex(&manifest_bytes),
        );
        // Blind pipeline: labels are not consulted until evaluate_ranking.
        let features = compute_features(&incident.envelopes, &config);
        let ranking = rank_candidates(&features, &RankingWeights::default());
        let eval = evaluate_ranking(
            &incident.labels.incident_id,
            &ranking,
            &incident.labels.root_cause_services,
        );
        let onsets = onset_report(
            &features,
            incident.labels.fault_start_time_ns,
            &incident.labels.root_cause_services,
        );
        outcomes.push(IncidentOutcome {
            incident_id: incident.labels.incident_id.clone(),
            fault_type: incident.labels.fault_type.clone(),
            eval,
            onsets,
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

    let overall = summarize(&outcomes.iter().map(|o| o.eval.clone()).collect::<Vec<_>>());
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

    let protocol = build_protocol(
        &opts.detector,
        &config,
        &opts.dataset_path,
        outcomes.iter().map(|o| o.incident_id.clone()).collect(),
        manifest_sha,
    )?;

    Ok(EvaluationReport {
        protocol,
        overall,
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
        dataset: opts.dataset_label.clone(),
    })
}

/// Onset diagnostics from a computed feature set. Labels are used only here,
/// after features exist, and never feed back into ranking.
pub fn onset_report(
    features: &FeatureSet,
    fault_start_ns: i64,
    root_cause_services: &[String],
) -> OnsetReport {
    let offset = |ns: i64| (ns - fault_start_ns) as f64 / 1e9;
    let onsets: BTreeMap<&str, i64> = features
        .candidates
        .iter()
        .filter_map(|c| c.onset_ns.map(|t| (c.service.as_str(), t)))
        .collect();
    let root_onset = onsets
        .iter()
        .filter(|(s, _)| root_cause_services.iter().any(|r| r == *s))
        .map(|(_, t)| *t)
        .min();
    let other_min = onsets
        .iter()
        .filter(|(s, _)| !root_cause_services.iter().any(|r| r == *s))
        .map(|(_, t)| *t)
        .min();
    let (strict, tied) = match (root_onset, other_min) {
        (Some(r), Some(o)) => (r < o, r == o),
        (Some(_), None) => (true, false),
        (None, _) => (false, false),
    };
    OnsetReport {
        incident_onset_ns: features.incident_onset_ns,
        fault_start_ns,
        incident_onset_offset_s: features.incident_onset_ns.map(offset),
        service_onset_offset_s: onsets
            .iter()
            .map(|(s, t)| ((*s).to_owned(), offset(*t)))
            .collect(),
        services_with_onset: onsets.len(),
        services_onset_before_fault: onsets.values().filter(|t| **t < fault_start_ns).count(),
        root_cause_onset_offset_s: root_onset.map(offset),
        root_cause_strictly_earliest: strict,
        root_cause_tied_earliest: tied,
    }
}

fn build_protocol(
    detector: &str,
    config: &FeatureConfig,
    dataset_path: &str,
    incident_ids: Vec<String>,
    incident_manifest_sha256: BTreeMap<String, String>,
) -> Result<Protocol, String> {
    let feature_config = serde_json::to_value(config).map_err(|e| e.to_string())?;
    let ranking_weights =
        serde_json::to_value(RankingWeights::default()).map_err(|e| e.to_string())?;
    let (git_commit, git_dirty_files) = git_state(Path::new(env!("CARGO_MANIFEST_DIR")));
    Ok(Protocol {
        detector: detector.to_owned(),
        feature_config_sha256: sha256_hex(canonical_json(&feature_config).as_bytes()),
        feature_config,
        ranking_weights_sha256: sha256_hex(canonical_json(&ranking_weights).as_bytes()),
        ranking_weights,
        canonical_serialization: "serde_json value, object keys sorted, no whitespace".into(),
        dataset_path: dataset_path.to_owned(),
        incident_ids,
        incident_manifest_sha256,
        git_commit,
        git_dirty_files,
        git_dirty_scope: GIT_DIRTY_SCOPE.join(" "),
    })
}

/// sha256 of a feature config's canonical serialization.
pub fn feature_config_sha256(config: &FeatureConfig) -> Result<String, String> {
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    Ok(sha256_hex(canonical_json(&value).as_bytes()))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Deterministic JSON text: object keys sorted recursively, no whitespace.
/// Independent of serde_json's `preserve_order` feature.
pub fn canonical_json(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let body: Vec<String> = keys
                .into_iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        Value::String(k.clone()),
                        canonical_json(&map[k.as_str()])
                    )
                })
                .collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(items) => {
            let body: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", body.join(","))
        }
        other => other.to_string(),
    }
}

/// (HEAD commit, dirty file count within [`GIT_DIRTY_SCOPE`]) for the repo
/// containing `dir`. `None` when git is unavailable.
pub fn git_state(dir: &Path) -> (Option<String>, Option<usize>) {
    let commit = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned());
    let dirty = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["status", "--porcelain", "--"])
        .args(GIT_DIRTY_SCOPE.iter().map(|p| format!(":(top){p}")))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count()
        });
    (commit, dirty)
}

/// The detector line under the report title. Only the legacy preset gets a
/// dated description; no preset is ever described as untuned.
pub fn detector_heading(detector: &str) -> String {
    if detector == "legacy" {
        "Detector: legacy detector (2026-08-03 configuration), spec 18.4 ranking weights.".into()
    } else {
        format!("Detector preset: {detector}, spec 18.4 ranking weights.")
    }
}

pub fn render_markdown(report: &EvaluationReport) -> String {
    let p = &report.protocol;
    let mut out = String::new();
    out.push_str(&format!(
        "# RCA evaluation ({} incidents, {})\n\n{}\n\n",
        report.incident_count,
        report.dataset,
        detector_heading(&p.detector)
    ));
    out.push_str(&format!(
        "Protocol: dataset `{}`, commit `{}` ({} dirty files in {}), feature config sha256 `{}`, ranking weights sha256 `{}`.\n\n",
        p.dataset_path,
        p.git_commit.as_deref().unwrap_or("unknown"),
        p.git_dirty_files
            .map(|n| n.to_string())
            .unwrap_or_else(|| "?".into()),
        p.git_dirty_scope,
        short(&p.feature_config_sha256),
        short(&p.ranking_weights_sha256),
    ));
    out.push_str("| metric | value |\n|---|---|\n");
    out.push_str(&format!(
        "| top-1 accuracy | {:.3} |\n",
        report.overall.top1_accuracy
    ));
    out.push_str(&format!(
        "| top-3 accuracy | {:.3} |\n",
        report.overall.top3_accuracy
    ));
    out.push_str(&format!("| MRR | {:.3} |\n", report.overall.mrr));
    out.push_str(&format!("| Avg@5 | {:.3} |\n\n", report.overall.avg5));
    out.push_str(
        "## Per fault type\n\n| fault | top-1 | top-3 | MRR | Avg@5 | n |\n|---|---|---|---|---|---|\n",
    );
    for (fault, s) in &report.per_fault_type {
        out.push_str(&format!(
            "| {fault} | {:.3} | {:.3} | {:.3} | {:.3} | {} |\n",
            s.top1_accuracy, s.top3_accuracy, s.mrr, s.avg5, s.incidents
        ));
    }
    out.push_str("\n## Ablations (component removed)\n\n| ablation | top-1 | top-3 | MRR | Avg@5 |\n|---|---|---|---|---|\n");
    for (name, s) in &report.ablations {
        out.push_str(&format!(
            "| {name} | {:.3} | {:.3} | {:.3} | {:.3} |\n",
            s.top1_accuracy, s.top3_accuracy, s.mrr, s.avg5
        ));
    }
    out.push_str(
        "\n## Onsets (seconds relative to labeled fault start)\n\n| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |\n|---|---|---|---|---|---|---|\n",
    );
    for o in &report.incidents {
        let s = &o.onsets;
        let earliest = if s.root_cause_strictly_earliest {
            "yes"
        } else if s.root_cause_tied_earliest {
            "tied"
        } else {
            "no"
        };
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            o.incident_id,
            o.eval
                .best_rank
                .map(|r| r.to_string())
                .unwrap_or_else(|| "-".into()),
            fmt_offset(s.incident_onset_offset_s),
            fmt_offset(s.root_cause_onset_offset_s),
            s.services_with_onset,
            s.services_onset_before_fault,
            earliest
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

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(12)]
}

fn fmt_offset(v: Option<f64>) -> String {
    v.map(|s| format!("{s:+.0}")).unwrap_or_else(|| "-".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use faultline_inference::features::CandidateFeatures;

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
            a.overall.top1_accuracy >= 0.5,
            "top1 collapsed: {:?}",
            a.overall
        );
    }

    #[test]
    fn single_fixture_stays_top1() {
        let dir = fixtures_root().join("synthetic-ob/v1/rec-mem-001");
        if !dir.exists() {
            return;
        }
        let report = evaluate_suite(&[dir]).unwrap();
        assert_eq!(report.overall.top1_accuracy, 1.0);
        assert_eq!(report.protocol.detector, "v2");
        assert_eq!(report.protocol.incident_ids, vec!["rec-mem-001".to_owned()]);
    }

    #[test]
    fn presets_map_to_detector_configs() {
        assert_eq!(detector_config("legacy").unwrap(), FeatureConfig::legacy());
        assert_eq!(detector_config("v2").unwrap(), FeatureConfig::v2());
        assert_eq!(
            detector_config("v2-no-floor").unwrap(),
            FeatureConfig::v2_no_floor()
        );
        assert_eq!(
            detector_config("v2-no-persistence").unwrap(),
            FeatureConfig::v2_no_persistence()
        );
        assert_eq!(
            detector_config("v2-window32").unwrap(),
            FeatureConfig::v2_window32()
        );
        assert!(detector_config("bogus").unwrap_err().contains("unknown"));
        // The build default and the harness default are the same preset.
        assert_eq!(DEFAULT_DETECTOR, "v2");
        assert_eq!(FeatureConfig::default(), FeatureConfig::v2());
        assert_ne!(FeatureConfig::legacy(), FeatureConfig::v2());
    }

    #[test]
    fn header_never_says_untuned() {
        for name in KNOWN_DETECTORS {
            let h = detector_heading(name);
            assert!(!h.to_lowercase().contains("untuned"), "{name}: {h}");
        }
        assert!(detector_heading("legacy").contains("legacy detector (2026-08-03 configuration)"));
        let v2 = detector_heading("v2");
        assert!(v2.contains("v2"));
        assert!(!v2.contains("2026-08-03"));
    }

    #[test]
    fn rendered_markdown_header_follows_preset() {
        let summary = summarize(&[]);
        let mut report = EvaluationReport {
            protocol: build_protocol(
                "v2",
                &FeatureConfig::default(),
                "rcaeval-re2-ob/v2",
                vec![],
                BTreeMap::new(),
            )
            .unwrap(),
            overall: summary.clone(),
            per_fault_type: BTreeMap::new(),
            ablations: BTreeMap::new(),
            incidents: vec![],
            confusion: vec![],
            dataset: "rcaeval-re2-ob/v2 (REAL RCAEval data)".into(),
            incident_count: 0,
        };
        let md = render_markdown(&report);
        assert!(!md.to_lowercase().contains("untuned"));
        assert!(md.contains("Detector preset: v2"));
        report.protocol.detector = "legacy".into();
        let md = render_markdown(&report);
        assert!(md.contains("legacy detector (2026-08-03 configuration)"));
        assert!(!md.to_lowercase().contains("untuned"));
    }

    #[test]
    fn canonical_json_sorts_keys_and_hash_is_stable() {
        let v: serde_json::Value = serde_json::json!({"b": 1, "a": {"d": [1.5, 2], "c": null}});
        assert_eq!(canonical_json(&v), r#"{"a":{"c":null,"d":[1.5,2]},"b":1}"#);
        let a = feature_config_sha256(&FeatureConfig::default()).unwrap();
        let b = feature_config_sha256(&FeatureConfig::default()).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
    }

    fn candidate(service: &str, onset_ns: Option<i64>) -> CandidateFeatures {
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
            onset_ns,
            peak_abs_z: 0.0,
            anomaly_refs: vec![],
            change_refs: vec![],
            log_refs: vec![],
            failed_trace_ids: vec![],
            impacted_anomalous: vec![],
            preceding_impacted: vec![],
        }
    }

    fn feature_set(c: Vec<CandidateFeatures>) -> FeatureSet {
        let incident_onset_ns = c.iter().filter_map(|c| c.onset_ns).min();
        FeatureSet {
            candidates: c,
            anomaly_intervals: vec![],
            incident_onset_ns,
            incident_end_ns: None,
        }
    }

    const SEC: i64 = 1_000_000_000;

    #[test]
    fn onset_report_offsets_and_strict_earliest() {
        let f = feature_set(vec![
            candidate("a", Some(95 * SEC)),
            candidate("b", Some(110 * SEC)),
            candidate("c", None),
            candidate("d", Some(80 * SEC)),
        ]);
        let r = onset_report(&f, 100 * SEC, &["d".into()]);
        assert_eq!(r.services_with_onset, 3);
        assert_eq!(r.services_onset_before_fault, 2);
        assert_eq!(r.incident_onset_offset_s, Some(-20.0));
        assert_eq!(r.root_cause_onset_offset_s, Some(-20.0));
        assert_eq!(r.service_onset_offset_s["b"], 10.0);
        assert!(!r.service_onset_offset_s.contains_key("c"));
        assert!(r.root_cause_strictly_earliest && !r.root_cause_tied_earliest);
    }

    #[test]
    fn onset_report_tie_and_miss() {
        let f = feature_set(vec![
            candidate("a", Some(100 * SEC)),
            candidate("b", Some(100 * SEC)),
            candidate("c", Some(90 * SEC)),
        ]);
        let tied = onset_report(&feature_set(f.candidates[..2].to_vec()), 0, &["a".into()]);
        assert!(!tied.root_cause_strictly_earliest && tied.root_cause_tied_earliest);
        let late = onset_report(&f, 0, &["a".into()]);
        assert!(!late.root_cause_strictly_earliest && !late.root_cause_tied_earliest);
        let none = onset_report(&feature_set(vec![candidate("a", None)]), 0, &["a".into()]);
        assert_eq!(none.root_cause_onset_offset_s, None);
        assert!(!none.root_cause_strictly_earliest && !none.root_cause_tied_earliest);
    }
}
