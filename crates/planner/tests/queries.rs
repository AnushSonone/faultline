//! M7 planner tests: subset enforcement, optimizer preservation, parity with
//! the product streaming path, EXPLAIN goldens.
//! Update goldens: UPDATE_GOLDEN=1 cargo test -p faultline-planner

use faultline_planner::{build_logical_plan, execute, optimize, parse, run_query, validate_query};
use faultline_replay::load_incident;
use std::path::PathBuf;

fn fixture_envelopes() -> Vec<faultline_common::TelemetryEnvelope> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../datasets/fixtures/synthetic-ob/v1/rec-mem-001");
    load_incident(dir).expect("fixture loads").envelopes
}

const Q_P99: &str = "SELECT service, TUMBLE(event_time, '1s'), P99(value) AS p99 \
                     FROM metrics WHERE name LIKE '%latency%' GROUP BY service";
const Q_ERROR_RATE: &str = "SELECT service, TUMBLE(event_time, '1s'), AVG(value) AS err \
                            FROM metrics WHERE name LIKE '%error_rate%' GROUP BY service";
const Q_DEPLOY_JOIN: &str = "SELECT service, name, value, change_id, delay_ns \
                             FROM metrics JOIN deployments ON service = service \
                             WHERE name LIKE '%latency%' AND change_id != '' \
                             ORDER BY delay_ns LIMIT 20";

#[test]
fn rejects_out_of_scope_constructs() {
    for (sql, needle) in [
        ("SELECT service FROM metrics; SELECT 1", "one statement"),
        ("SELECT DISTINCT service FROM metrics", "DISTINCT"),
        (
            "SELECT service FROM metrics ORDER BY service",
            "requires LIMIT",
        ),
        ("SELECT service FROM nope", "unknown table"),
        ("SELECT ghost FROM metrics", "unknown column"),
        (
            "SELECT service FROM metrics WHERE value IN (SELECT value FROM metrics)",
            "unsupported",
        ),
    ] {
        let err = validate_query(sql).unwrap_err();
        assert!(
            err.to_ascii_lowercase()
                .contains(&needle.to_ascii_lowercase()),
            "{sql}: expected '{needle}' in '{err}'"
        );
    }
}

/// Spec 25.2 property: the optimizer preserves results.
#[test]
fn optimizer_preserves_results() {
    let envelopes = fixture_envelopes();
    let cursor = i64::MAX / 4;
    for sql in [Q_P99, Q_ERROR_RATE, Q_DEPLOY_JOIN] {
        let query = parse(sql).unwrap();
        let logical = build_logical_plan(&query);
        let optimized = optimize(logical.clone());
        let raw = execute(&logical, &envelopes, cursor).unwrap();
        let opt = execute(&optimized, &envelopes, cursor).unwrap();
        assert_eq!(raw.rows, opt.rows, "optimizer changed results for {sql}");
    }
}

/// M7 exit criterion: SQL results match the product reference path. The p99
/// query runs through the same DDSketch type and alpha as the streaming
/// heatmap's percentile operator; per (service, window) the estimates must
/// agree exactly.
#[test]
fn p99_query_matches_streaming_pipeline() {
    use faultline_engine::{HeatmapStreamingPipeline, ProjectionMode};
    let envelopes = fixture_envelopes();
    let cursor = i64::MAX / 4;

    let (result, _) = run_query(Q_P99, &envelopes, cursor).unwrap();
    let mut sql_p99: std::collections::BTreeMap<(String, i64), f64> = Default::default();
    for row in &result.rows {
        let svc = match row.get("service") {
            Some(faultline_planner::physical::Value::Text(s)) => s.clone(),
            other => panic!("bad service {other:?}"),
        };
        let ws = match row.get("window_start") {
            Some(faultline_planner::physical::Value::Int(i)) => *i,
            other => panic!("bad window {other:?}"),
        };
        if let Some(faultline_planner::physical::Value::Float(v)) = row.get("p99") {
            sql_p99.insert((svc, ws), *v);
        }
    }
    assert!(!sql_p99.is_empty(), "SQL query produced no p99 rows");

    let mut pipeline = HeatmapStreamingPipeline::new(ProjectionMode::Streaming);
    let _ = pipeline.rebuild_until(&envelopes, cursor);
    let mut checked = 0;
    for emit in pipeline
        .percentile_emits()
        .iter()
        .filter(|e| e.percentile == "p99" && e.finalized)
    {
        let key = (emit.service.clone(), emit.window_start_ns);
        if let Some(sql_value) = sql_p99.get(&key) {
            assert!(
                (sql_value - emit.estimated_value).abs() < 1e-9,
                "{key:?}: sql {sql_value} != pipeline {}",
                emit.estimated_value
            );
            checked += 1;
        }
    }
    assert!(
        checked >= 10,
        "too few overlapping windows checked: {checked}"
    );
}

#[test]
fn deploy_join_query_finds_correlated_change() {
    let envelopes = fixture_envelopes();
    let (result, _) = run_query(Q_DEPLOY_JOIN, &envelopes, i64::MAX / 4).unwrap();
    assert!(!result.rows.is_empty());
    let any_rec = result.rows.iter().any(|r| {
        matches!(r.get("service"), Some(faultline_planner::physical::Value::Text(s)) if s == "recommendationservice")
            && matches!(r.get("change_id"), Some(faultline_planner::physical::Value::Text(c)) if c == "deploy-rec-v2")
    });
    assert!(any_rec, "join did not correlate the fixture deployment");
    assert!(result.rows.len() <= 20, "LIMIT not applied");
}

#[test]
fn execution_is_deterministic() {
    let envelopes = fixture_envelopes();
    for sql in [Q_P99, Q_ERROR_RATE, Q_DEPLOY_JOIN] {
        // Compare data only; wall-time in metrics legitimately varies.
        let a = run_query(sql, &envelopes, i64::MAX / 4).unwrap().0;
        let b = run_query(sql, &envelopes, i64::MAX / 4).unwrap().0;
        assert_eq!(
            serde_json::to_string(&(a.columns, a.rows)).unwrap(),
            serde_json::to_string(&(b.columns, b.rows)).unwrap(),
            "nondeterministic execution for {sql}"
        );
    }
}

/// Spec 25.3 golden: EXPLAIN output stability for the canonical queries.
#[test]
fn explain_matches_golden() {
    let golden_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden");
    for (name, sql) in [
        ("p99_heatmap", Q_P99),
        ("error_rate", Q_ERROR_RATE),
        ("deploy_join", Q_DEPLOY_JOIN),
    ] {
        let out = validate_query(sql).unwrap();
        let rendered = serde_json::to_string_pretty(&out).unwrap();
        let path = golden_dir.join(format!("explain_{name}.json"));
        if std::env::var("UPDATE_GOLDEN").is_ok() {
            std::fs::create_dir_all(&golden_dir).unwrap();
            std::fs::write(&path, &rendered).unwrap();
            continue;
        }
        let golden = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("golden {name} missing; run with UPDATE_GOLDEN=1"));
        assert_eq!(rendered, golden, "EXPLAIN drifted for {name}");
    }
}

#[test]
fn optimizer_applies_expected_rewrites() {
    // Filter pushes below Window; LIMIT above Sort becomes top-k.
    let q = parse(Q_P99).unwrap();
    let optimized = optimize(build_logical_plan(&q));
    let rendered = optimized.render();
    let filter_pos = rendered.find("Filter").unwrap();
    let window_pos = rendered.find("Window").unwrap();
    assert!(
        window_pos < filter_pos,
        "filter should sit below the window:\n{rendered}"
    );

    let q2 = parse(Q_DEPLOY_JOIN).unwrap();
    let rendered2 = optimize(build_logical_plan(&q2)).render();
    assert!(rendered2.contains("(top-k)"), "no top-k:\n{rendered2}");

    // Constant folding removes a tautology.
    let q3 = parse("SELECT service FROM metrics WHERE 1 = 1 LIMIT 5").unwrap();
    let rendered3 = optimize(build_logical_plan(&q3)).render();
    assert!(
        !rendered3.contains("Filter"),
        "tautology not folded:\n{rendered3}"
    );
}
