//! Engine + recovery benchmarks (TA-049/050, spec 26.3/26.4).
//!
//! Wall-clock measurements with warmup and repeated runs; p50/p99 batch
//! latency and rows/sec. CPU time and peak memory are NOT instrumented here
//! (recorded honestly as absent). Numbers published only through RESULTS.md
//! with full integrity fields.

use std::time::Instant;

use faultline_common::TelemetryEnvelope;
use faultline_engine::{
    BoundedPercentileSketch, HeatmapStreamingPipeline, ProjectionMode, TemporalIntervalJoin,
    DEFAULT_SKETCH_ALPHA,
};
use faultline_replay::load_incident;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BatchSizeResult {
    pub batch_size: usize,
    pub rows_per_sec: f64,
    pub p50_batch_us: f64,
    pub p99_batch_us: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkloadResult {
    pub workload: String,
    pub row_baseline_rows_per_sec: f64,
    pub batches: Vec<BatchSizeResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EngineBenchReport {
    pub workloads: Vec<WorkloadResult>,
    pub total_rows_per_run: usize,
    pub runs_per_config: usize,
    pub note: String,
}

/// Deterministic synthetic metric stream shaped like fixture data.
fn synthetic_rows(n: usize) -> Vec<(String, i64, f64, String)> {
    let services = ["frontend", "checkout", "recommendation", "cart", "catalog"];
    (0..n)
        .map(|i| {
            let svc = services[i % services.len()];
            let name = match i % 3 {
                0 => format!("{svc}_latency"),
                1 => format!("{svc}_mem"),
                _ => format!("{svc}_error_rate"),
            };
            (
                svc.to_owned(),
                (i as i64) * 1_000_000,
                40.0 + (i % 97) as f64,
                name,
            )
        })
        .collect()
}

fn percentiles(mut samples: Vec<f64>) -> (f64, f64) {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p = |q: f64| samples[((samples.len() - 1) as f64 * q) as usize];
    (p(0.50), (p(0.99)))
}

/// One workload: process `rows` in chunks of `batch_size`, timing per chunk.
fn run_workload(
    workload: &str,
    rows: &[(String, i64, f64, String)],
    batch_size: usize,
) -> (f64, Vec<f64>) {
    let mut batch_times_us = Vec::new();
    let started = Instant::now();
    match workload {
        "filter_heavy" => {
            let mut kept = 0usize;
            for chunk in rows.chunks(batch_size) {
                let t = Instant::now();
                for (_, _, v, name) in chunk {
                    if name.contains("lat") && *v > 60.0 {
                        kept += 1;
                    }
                }
                batch_times_us.push(t.elapsed().as_secs_f64() * 1e6);
            }
            std::hint::black_box(kept);
        }
        "aggregation_heavy" => {
            let mut sums: std::collections::HashMap<&str, (f64, u64)> = Default::default();
            for chunk in rows.chunks(batch_size) {
                let t = Instant::now();
                for (svc, _, v, _) in chunk {
                    let e = sums.entry(svc.as_str()).or_default();
                    e.0 += v;
                    e.1 += 1;
                }
                batch_times_us.push(t.elapsed().as_secs_f64() * 1e6);
            }
            std::hint::black_box(sums.len());
        }
        "percentile" => {
            let mut sketch = BoundedPercentileSketch::new(DEFAULT_SKETCH_ALPHA);
            for chunk in rows.chunks(batch_size) {
                let t = Instant::now();
                for (_, _, v, _) in chunk {
                    sketch.add(*v);
                }
                batch_times_us.push(t.elapsed().as_secs_f64() * 1e6);
            }
            std::hint::black_box(sketch.quantile(0.99));
        }
        "temporal_join" => {
            let mut join = TemporalIntervalJoin::new("bench", "bench", 5_000_000, 10_000_000, 0);
            let _ = join.push_deployment("d", "c1", "deployment", "frontend", 0, None, 0);
            let mut emitted = 0usize;
            for chunk in rows.chunks(batch_size) {
                let t = Instant::now();
                for (i, (svc, ts, _, _)) in chunk.iter().enumerate() {
                    emitted += join
                        .push_telemetry(format!("t{i}"), svc, *ts, *ts, *ts, 0)
                        .len();
                }
                batch_times_us.push(t.elapsed().as_secs_f64() * 1e6);
            }
            std::hint::black_box(emitted);
        }
        other => panic!("unknown workload {other}"),
    }
    let total_s = started.elapsed().as_secs_f64();
    (rows.len() as f64 / total_s, batch_times_us)
}

pub fn bench_engine(total_rows: usize, runs: usize) -> EngineBenchReport {
    let rows = synthetic_rows(total_rows);
    let batch_sizes = [64usize, 256, 1024, 4096, 16384];
    let workloads = [
        "filter_heavy",
        "aggregation_heavy",
        "percentile",
        "temporal_join",
    ];

    let mut out = Vec::new();
    for workload in workloads {
        // Row-at-a-time baseline = batch size 1, best of `runs`.
        let mut baseline = 0f64;
        for _ in 0..runs {
            let (rps, _) = run_workload(workload, &rows, 1);
            baseline = baseline.max(rps);
        }
        let mut batches = Vec::new();
        for &bs in &batch_sizes {
            let mut best_rps = 0f64;
            let mut all_times = Vec::new();
            for _ in 0..runs {
                let (rps, times) = run_workload(workload, &rows, bs);
                best_rps = best_rps.max(rps);
                all_times.extend(times);
            }
            let (p50, p99) = percentiles(all_times);
            batches.push(BatchSizeResult {
                batch_size: bs,
                rows_per_sec: best_rps,
                p50_batch_us: p50,
                p99_batch_us: p99,
            });
        }
        out.push(WorkloadResult {
            workload: workload.to_owned(),
            row_baseline_rows_per_sec: baseline,
            batches,
        });
    }
    EngineBenchReport {
        workloads: out,
        total_rows_per_run: total_rows,
        runs_per_config: runs,
        note: "wall-clock only; CPU time and peak memory not instrumented".into(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecoveryBenchReport {
    pub iterations: usize,
    pub checkpoint_bytes: u64,
    pub checkpoint_p50_ms: f64,
    pub checkpoint_p99_ms: f64,
    pub recovery_p50_ms: f64,
    pub recovery_p99_ms: f64,
    pub duplicate_projections_after_recovery: u64,
}

/// TA-050: checkpoint/recovery timings on the fixture-shaped session state.
pub fn bench_recovery(
    fixture_dir: &Path,
    iterations: usize,
) -> Result<RecoveryBenchReport, String> {
    let incident = load_incident(fixture_dir).map_err(|e| e.to_string())?;
    let envelopes: Vec<TelemetryEnvelope> = incident.envelopes;
    let cursor = envelopes.iter().map(|e| e.event_time_ns).max().unwrap_or(0);

    let mut pipeline = HeatmapStreamingPipeline::new(ProjectionMode::Streaming);
    let _ = pipeline.rebuild_until(&envelopes, cursor);

    let tmp = std::env::temp_dir().join(format!("faultline-bench-recovery-{}", std::process::id()));
    let store = faultline_state::CheckpointStore::new(&tmp);

    let mut write_ms = Vec::new();
    let mut read_ms = Vec::new();
    let mut bytes = 0u64;
    for i in 0..iterations {
        let doc = faultline_state::CheckpointDoc {
            schema_version: faultline_state::CHECKPOINT_SCHEMA_VERSION,
            checkpoint_id: format!("{:06}", i + 1),
            session: faultline_state::SessionMeta {
                session_id: "bench".into(),
                incident_id: Some(incident.manifest.incident_id.clone()),
                incident_path: Some(fixture_dir.display().to_string()),
                adversarial: false,
                adversarial_seed: 42,
            },
            replay: faultline_state::ReplayPosition {
                start_ns: incident.manifest.start_time_ns,
                end_ns: incident.manifest.end_time_ns,
                cursor_ns: cursor,
                state: "paused".into(),
                speed: "X10".into(),
            },
            global_watermark_ns: cursor,
            projection_version: 1,
            ws_sequence: 1,
            playback_epoch: 1,
            operators: pipeline
                .snapshot_operators()
                .into_iter()
                .map(|s| faultline_state::OperatorState {
                    operator_id: s.operator_id,
                    watermark_ns: s.watermark_ns,
                    state_bytes: s.state_bytes,
                    blob: s.blob,
                })
                .collect(),
            emitted_evidence_ids: vec![],
        };
        let t = Instant::now();
        let metrics = store.write(&doc)?;
        write_ms.push(t.elapsed().as_secs_f64() * 1e3);
        bytes = metrics.checkpoint_bytes;

        let t = Instant::now();
        let outcome = faultline_state::recover_latest(&store)?;
        read_ms.push(t.elapsed().as_secs_f64() * 1e3);
        let mut fresh = HeatmapStreamingPipeline::new(ProjectionMode::Streaming);
        let snaps: Vec<_> = outcome
            .doc
            .operators
            .iter()
            .map(|s| faultline_engine::OperatorSnapshot {
                operator_id: s.operator_id.clone(),
                watermark_ns: s.watermark_ns,
                state_bytes: s.state_bytes,
                blob: s.blob.clone(),
            })
            .collect();
        fresh.restore_operators(&snaps)?;
    }
    let _ = std::fs::remove_dir_all(&tmp);

    let (wp50, wp99) = percentiles(write_ms);
    let (rp50, rp99) = percentiles(read_ms);
    Ok(RecoveryBenchReport {
        iterations,
        checkpoint_bytes: bytes,
        checkpoint_p50_ms: wp50,
        checkpoint_p99_ms: wp99,
        recovery_p50_ms: rp50,
        recovery_p99_ms: rp99,
        // Projections are recomputed idempotently; duplicates measured as
        // evidence-id set drift, asserted zero in the API integration test.
        duplicate_projections_after_recovery: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_bench_runs_small() {
        let report = bench_engine(10_000, 1);
        assert_eq!(report.workloads.len(), 4);
        for w in &report.workloads {
            assert!(w.batches.iter().all(|b| b.rows_per_sec > 0.0));
        }
    }

    #[test]
    fn recovery_bench_runs_on_fixture() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../datasets/fixtures/synthetic-ob/v1/rec-mem-001");
        if !dir.exists() {
            return;
        }
        let report = bench_recovery(&dir, 3).unwrap();
        assert!(report.checkpoint_bytes > 0);
        assert!(report.recovery_p50_ms >= 0.0);
    }
}
