//! Golden test: evidence graph structure on the fixture is stable (spec 25.3).
//!
//! Update with: UPDATE_GOLDEN=1 cargo test -p faultline-inference --test
//! evidence_graph_golden

use faultline_inference::evidence_graph::build_evidence_graph;
use faultline_inference::features::{compute_features, FeatureConfig};
use faultline_inference::ranking::{rank_candidates, RankingWeights};
use faultline_replay::load_incident;
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../datasets/fixtures/synthetic-ob/v1/rec-mem-001")
}

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/evidence_graph.json")
}

#[test]
fn evidence_graph_matches_golden() {
    let incident = load_incident(fixture_dir()).expect("fixture loads");
    let features = compute_features(&incident.envelopes, &FeatureConfig::default());
    let ranking = rank_candidates(&features, &RankingWeights::default());
    let graph = build_evidence_graph("rec-mem-001", &features, &ranking, 3);
    let rendered = serde_json::to_string_pretty(&graph).expect("serializes");

    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::create_dir_all(golden_path().parent().unwrap()).unwrap();
        std::fs::write(golden_path(), &rendered).unwrap();
        return;
    }
    let golden = std::fs::read_to_string(golden_path())
        .expect("golden file missing; run with UPDATE_GOLDEN=1");
    assert_eq!(
        rendered, golden,
        "evidence graph drifted from golden; if intended, rerun with UPDATE_GOLDEN=1"
    );
}
