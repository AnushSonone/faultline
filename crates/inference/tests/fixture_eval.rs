//! M4 initial evaluation against the synthetic-ob fixture (exit-gate check).
//!
//! The pipeline runs blind: envelopes in, ranking out. Labels are read only
//! afterward, in this test, to score the finished ranking. This is the same
//! score implementation the backend will serve (spec 18.4 rule).

use faultline_inference::anomaly::StreamHorizon;
use faultline_inference::eval::{evaluate_ranking, summarize};
use faultline_inference::evidence::{evidence_for_ranking, EvidenceDirection};
use faultline_inference::features::{
    compute_features, compute_features_at, FeatureConfig, FeatureSet,
};
use faultline_inference::ranking::{rank_candidates, RankingWeights};
use faultline_replay::load_incident;
use std::collections::BTreeMap;
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

/// Serialise a feature set without the interval fields added by the v2
/// detector, for comparison against output captured before they existed.
fn without_v2_interval_fields(set: &FeatureSet) -> String {
    let mut v = serde_json::to_value(set).unwrap();
    for iv in v["anomaly_intervals"].as_array_mut().unwrap() {
        let obj = iv.as_object_mut().unwrap();
        for k in [
            "baseline_span_ns",
            "required_persistence_ns",
            "qualified_ns",
        ] {
            assert!(obj.remove(k).is_some(), "missing {k}");
        }
    }
    serde_json::to_string(&v).unwrap()
}

#[test]
fn legacy_preset_reproduces_prechange_features() {
    // Captured from the detector before the v2 change, on this fixture.
    let golden_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/legacy_rec_mem_001_features.json");
    let golden = std::fs::read_to_string(golden_path).expect("legacy snapshot present");
    let incident = load_incident(fixture_dir()).expect("fixture loads");
    let set = compute_features(&incident.envelopes, &FeatureConfig::legacy());
    assert_eq!(without_v2_interval_fields(&set), golden);
}

fn onsets(set: &FeatureSet) -> BTreeMap<String, i64> {
    set.candidates
        .iter()
        .filter_map(|c| c.onset_ns.map(|t| (c.service.clone(), t)))
        .collect()
}

#[test]
fn prefix_replay_onsets_are_monotone_and_converge() {
    let incident = load_incident(fixture_dir()).expect("fixture loads");
    let envs = &incident.envelopes;
    let config = FeatureConfig::default();
    let t0 = envs.iter().map(|e| e.event_time_ns).min().unwrap();
    let sec = 1_000_000_000i64;

    let mut cursors: Vec<i64> = envs.iter().map(|e| e.event_time_ns).collect();
    cursors.sort_unstable();
    cursors.dedup();
    for probe in [11 * sec, 12 * sec] {
        if !cursors.contains(&(t0 + probe)) {
            cursors.push(t0 + probe);
        }
    }
    cursors.sort_unstable();

    // Same horizon rule as the live projection.
    let at = |cursor: i64| {
        let visible: Vec<_> = envs
            .iter()
            .filter(|e| e.event_time_ns <= cursor)
            .cloned()
            .collect();
        let horizon = if visible.len() == envs.len() {
            StreamHorizon::Complete
        } else {
            StreamHorizon::Partial
        };
        compute_features_at(&visible, &config, horizon)
    };

    let mut prev: BTreeMap<String, i64> = BTreeMap::new();
    let mut last = None;
    for &cursor in &cursors {
        let set = at(cursor);
        let now = onsets(&set);
        for (service, onset) in &prev {
            let current = now
                .get(service)
                .unwrap_or_else(|| panic!("{service} lost its onset at cursor +{}ns", cursor - t0));
            assert!(
                current <= onset,
                "{service} onset moved later at cursor +{}ns",
                cursor - t0
            );
        }
        if cursor == t0 + 11 * sec {
            assert!(now.is_empty(), "cursor 11s: {now:?}");
        }
        if cursor == t0 + 12 * sec {
            assert_eq!(
                now.keys().map(String::as_str).collect::<Vec<_>>(),
                vec!["recommendationservice"],
                "cursor 12s"
            );
        }
        prev = now;
        last = Some(set);
    }
    let offline = compute_features(envs, &config);
    assert_eq!(last.expect("cursors"), offline);
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
