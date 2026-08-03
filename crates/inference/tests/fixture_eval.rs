//! M4 initial evaluation against the synthetic-ob fixture (exit-gate check).
//!
//! The pipeline runs blind: envelopes in, ranking out. Labels are read only
//! afterward, in this test, to score the finished ranking. This is the same
//! score implementation the backend will serve (spec 18.4 rule).

use faultline_inference::eval::{evaluate_ranking, summarize};
use faultline_inference::evidence::{evidence_for_ranking, EvidenceDirection};
use faultline_inference::features::{compute_features, FeatureConfig};
use faultline_inference::ranking::{rank_candidates, RankingWeights};
use faultline_replay::load_incident;
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../datasets/fixtures/synthetic-ob/v1/rec-mem-001")
}

#[test]
fn fixture_ranking_places_labeled_root_cause_first() {
    let incident = load_incident(fixture_dir()).expect("fixture loads");

    // Pipeline: no labels in scope.
    let features = compute_features(&incident.envelopes, &FeatureConfig::default());
    let ranking = rank_candidates(&features, &RankingWeights::default());

    assert!(
        features.incident_onset_ns.is_some(),
        "fixture fault must produce anomaly intervals"
    );

    // Evaluation mode: labels enter only now.
    let labels = &incident.labels;
    let eval = evaluate_ranking(&labels.incident_id, &ranking, &labels.root_cause_services);
    let summary = summarize(std::slice::from_ref(&eval));

    eprintln!("ranking:");
    for c in &ranking.candidates {
        eprintln!("  #{} {} score={:.4}", c.rank, c.service, c.score);
    }
    eprintln!(
        "eval: top1={} top3={} mrr={:.3}",
        summary.top1_accuracy, summary.top3_accuracy, summary.mrr
    );

    assert!(eval.top1, "labeled root cause must rank first: {eval:?}");
    assert_eq!(summary.mrr, 1.0);

    // Detected onset should sit near the labeled fault start (within 2s of
    // metric cadence), without ever having read the label during inference.
    let onset = features.incident_onset_ns.unwrap();
    assert!(
        (onset - labels.fault_start_time_ns).abs() <= 2_000_000_000,
        "onset {onset} vs labeled fault start {}",
        labels.fault_start_time_ns
    );
}

#[test]
fn fixture_top_candidate_has_inspectable_decomposition_and_evidence() {
    let incident = load_incident(fixture_dir()).expect("fixture loads");
    let features = compute_features(&incident.envelopes, &FeatureConfig::default());
    let ranking = rank_candidates(&features, &RankingWeights::default());
    let top = &ranking.candidates[0];

    // Every score component is present and contributions reconcile.
    assert_eq!(top.components.len(), 9);
    let sum: f64 = top.components.iter().map(|c| c.contribution).sum();
    assert!((sum - top.score).abs() < 1e-12);

    // Evidence exists, is tied to real telemetry, and negative evidence for
    // downstream services is visible.
    let evidence = evidence_for_ranking("rec-mem-001", &features, &ranking);
    let top_evidence: Vec<_> = evidence
        .iter()
        .filter(|e| e.candidate_service == top.service)
        .collect();
    assert!(!top_evidence.is_empty());
    assert!(top_evidence.iter().any(|e| !e.source_refs.is_empty()));
    assert!(evidence
        .iter()
        .any(|e| e.direction == EvidenceDirection::Contradicts));
}

#[test]
fn fixture_pipeline_is_deterministic_end_to_end() {
    let run = || {
        let incident = load_incident(fixture_dir()).expect("fixture loads");
        let features = compute_features(&incident.envelopes, &FeatureConfig::default());
        let ranking = rank_candidates(&features, &RankingWeights::default());
        let evidence = evidence_for_ranking("rec-mem-001", &features, &ranking);
        serde_json::to_string(&(ranking, evidence)).expect("serializes")
    };
    assert_eq!(run(), run());
}
