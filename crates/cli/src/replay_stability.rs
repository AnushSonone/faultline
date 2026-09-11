//! Replay stability of the live root-cause projection.
//!
//! Steps a cursor through each incident and calls the same
//! `build_root_causes` the API serves, so the numbers describe what a user
//! watching a replay would see: when a ranking first appears, how often the
//! top-1 changes, and whether detector onsets flicker off again.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use faultline_inference::features::FeatureConfig;
use faultline_projection::build_root_causes;
use faultline_replay::load_incident;
use serde::{Deserialize, Serialize};

use crate::evaluate::{detector_config, feature_config_sha256, git_state};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StabilityReport {
    pub detector: String,
    pub detector_note: String,
    pub feature_config_sha256: String,
    pub dataset_path: String,
    pub step_s: u64,
    pub timing_repeats: usize,
    pub git_commit: Option<String>,
    pub git_dirty_files: Option<usize>,
    pub definitions: BTreeMap<String, String>,
    pub incidents: Vec<IncidentStability>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IncidentStability {
    pub incident_id: String,
    pub labeled_root_cause: Vec<String>,
    pub fault_start_ns: i64,
    pub start_ns: i64,
    pub end_ns: i64,
    pub cursors: usize,
    /// Seconds from fault start to the first cursor with a non-empty ranking.
    pub first_nonempty_ranking_offset_s: Option<f64>,
    /// Seconds from fault start to the first cursor with any detector onset.
    pub first_onset_cursor_offset_s: Option<f64>,
    pub top1_changes_after_first_ranking: usize,
    pub final_top1: Option<String>,
    pub final_top1_is_labeled: bool,
    /// Seconds from fault start to the first cursor whose top-1 is the final top-1.
    pub final_top1_first_seen_offset_s: Option<f64>,
    /// Seconds from fault start to the cursor from which the top-1 stays the final top-1.
    pub final_top1_stable_from_offset_s: Option<f64>,
    pub flicker_count: usize,
    pub onset_shift_count: usize,
    pub last_cursor_call_ms: TimingStats,
    pub timeline: Vec<CursorSample>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CursorSample {
    pub offset_s: f64,
    pub top1: Option<String>,
    pub candidates: usize,
    pub services_with_onset: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TimingStats {
    pub samples: usize,
    pub median_ms: f64,
    pub p95_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
}

/// What one cursor contributed to the stability metrics.
#[derive(Clone, Debug, PartialEq)]
pub struct CursorObservation {
    pub cursor_ns: i64,
    pub top1: Option<String>,
    pub candidates: usize,
    /// service -> onset_ns for services with a detector onset at this cursor.
    pub onsets: BTreeMap<String, i64>,
}

/// Aggregate metrics over an ordered cursor sweep.
#[derive(Clone, Debug, PartialEq)]
pub struct SweepMetrics {
    pub first_nonempty_ranking_ns: Option<i64>,
    pub first_onset_cursor_ns: Option<i64>,
    pub top1_changes_after_first_ranking: usize,
    pub final_top1: Option<String>,
    pub final_top1_first_seen_ns: Option<i64>,
    pub final_top1_stable_from_ns: Option<i64>,
    pub flicker_count: usize,
    pub onset_shift_count: usize,
}

pub fn sweep_metrics(obs: &[CursorObservation]) -> SweepMetrics {
    let first_idx = obs.iter().position(|o| o.candidates > 0);
    let top1_changes = first_idx
        .map(|i| {
            obs[i..]
                .windows(2)
                .filter(|w| w[0].top1 != w[1].top1)
                .count()
        })
        .unwrap_or(0);
    let final_top1 = obs.last().and_then(|o| o.top1.clone());
    let (first_seen, stable_from) = match &final_top1 {
        Some(f) => {
            let first = obs.iter().find(|o| o.top1.as_ref() == Some(f));
            let stable_idx = obs
                .iter()
                .rposition(|o| o.top1.as_ref() != Some(f))
                .map_or(0, |i| i + 1);
            (first.map(|o| o.cursor_ns), Some(obs[stable_idx].cursor_ns))
        }
        None => (None, None),
    };
    let mut flicker = 0;
    let mut shifts = 0;
    for w in obs.windows(2) {
        for (service, onset) in &w[0].onsets {
            match w[1].onsets.get(service) {
                None => flicker += 1,
                Some(later) if later != onset => shifts += 1,
                Some(_) => {}
            }
        }
    }
    SweepMetrics {
        first_nonempty_ranking_ns: first_idx.map(|i| obs[i].cursor_ns),
        first_onset_cursor_ns: obs
            .iter()
            .find(|o| !o.onsets.is_empty())
            .map(|o| o.cursor_ns),
        top1_changes_after_first_ranking: top1_changes,
        final_top1,
        final_top1_first_seen_ns: first_seen,
        final_top1_stable_from_ns: stable_from,
        flicker_count: flicker,
        onset_shift_count: shifts,
    }
}

/// Cursor positions from `start` to `end` every `step_ns`, always ending at `end`.
pub fn cursor_positions(start_ns: i64, end_ns: i64, step_ns: i64) -> Vec<i64> {
    let mut out = Vec::new();
    if step_ns <= 0 || end_ns < start_ns {
        return vec![end_ns];
    }
    let mut c = start_ns;
    while c < end_ns {
        out.push(c);
        c += step_ns;
    }
    out.push(end_ns);
    out
}

/// Nearest-rank percentile over samples (sorted internally).
pub fn timing_stats(samples_ms: &[f64]) -> TimingStats {
    let mut s = samples_ms.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let n = s.len();
    if n == 0 {
        return TimingStats {
            samples: 0,
            median_ms: 0.0,
            p95_ms: 0.0,
            min_ms: 0.0,
            max_ms: 0.0,
        };
    }
    let rank = |p: f64| s[((p * n as f64).ceil() as usize).clamp(1, n) - 1];
    let median = if n % 2 == 1 {
        s[n / 2]
    } else {
        (s[n / 2 - 1] + s[n / 2]) / 2.0
    };
    TimingStats {
        samples: n,
        median_ms: median,
        p95_ms: rank(0.95),
        min_ms: s[0],
        max_ms: s[n - 1],
    }
}

pub fn replay_stability(
    fixtures_root: &Path,
    dataset_path: &str,
    incident_ids: &[String],
    detector: &str,
    step_s: u64,
    timing_repeats: usize,
) -> Result<StabilityReport, String> {
    let config = detector_config(detector)?;
    // build_root_causes takes no config: it always runs FeatureConfig::default().
    // Refuse rather than silently report the wrong preset.
    if config != FeatureConfig::default() {
        return Err(format!(
            "replay-stability measures the live projection, which uses this build's \
             FeatureConfig::default(); preset '{detector}' differs from that default"
        ));
    }
    if step_s == 0 {
        return Err("--step-s must be positive".into());
    }
    let mut incidents = Vec::new();
    for id in incident_ids {
        let dir = fixtures_root.join(dataset_path).join(id);
        if !dir.join("manifest.json").exists() {
            return Err(format!("incident not found: {}", dir.display()));
        }
        incidents.push(stability_for(&dir, step_s, timing_repeats)?);
    }
    let (git_commit, git_dirty_files) = git_state(Path::new(env!("CARGO_MANIFEST_DIR")));
    let definitions = [
        ("offsets", "seconds relative to labels.fault_start_time_ns; negative is before the injection"),
        ("cursors", "manifest start_time_ns, then every step_s, plus the final end_time_ns cursor"),
        ("first_nonempty_ranking_offset_s", "first cursor where build_root_causes returns at least one candidate"),
        ("first_onset_cursor_offset_s", "first cursor where any candidate has a detector onset"),
        ("top1_changes_after_first_ranking", "consecutive cursor pairs, from the first non-empty ranking on, whose top-1 service differs"),
        ("final_top1_first_seen_offset_s", "first cursor whose top-1 equals the top-1 at the end cursor"),
        ("final_top1_stable_from_offset_s", "cursor from which every later top-1 equals the final top-1"),
        ("flicker_count", "sum over consecutive cursor pairs and services of: service had an onset at the earlier cursor and none at the later cursor"),
        ("onset_shift_count", "sum over consecutive cursor pairs and services of: onset present at both cursors but at a different time"),
        ("last_cursor_call_ms", "wall time of build_root_causes at the end cursor, repeated timing_repeats times after the sweep; nearest-rank p95"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    Ok(StabilityReport {
        detector: detector.to_owned(),
        detector_note: "live projection path (faultline_projection::build_root_causes), FeatureConfig::default() of this build".into(),
        feature_config_sha256: feature_config_sha256(&config)?,
        dataset_path: dataset_path.to_owned(),
        step_s,
        timing_repeats,
        git_commit,
        git_dirty_files,
        definitions,
        incidents,
    })
}

fn stability_for(
    dir: &Path,
    step_s: u64,
    timing_repeats: usize,
) -> Result<IncidentStability, String> {
    let incident = load_incident(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let id = incident.labels.incident_id.clone();
    let fault_start = incident.labels.fault_start_time_ns;
    let (start, end) = (
        incident.manifest.start_time_ns,
        incident.manifest.end_time_ns,
    );
    let offset = |ns: i64| (ns - fault_start) as f64 / 1e9;

    let mut obs = Vec::new();
    for (version, cursor) in cursor_positions(start, end, step_s as i64 * 1_000_000_000)
        .into_iter()
        .enumerate()
    {
        let proj = build_root_causes(&id, &incident.envelopes, cursor, version as u64);
        obs.push(CursorObservation {
            cursor_ns: cursor,
            top1: proj.candidates.first().map(|c| c.service.clone()),
            candidates: proj.candidates.len(),
            onsets: proj
                .candidates
                .iter()
                .filter_map(|c| c.features.onset_ns.map(|t| (c.service.clone(), t)))
                .collect(),
        });
    }

    let mut samples = Vec::with_capacity(timing_repeats);
    for i in 0..timing_repeats {
        let t0 = Instant::now();
        let proj = build_root_causes(&id, &incident.envelopes, end, (obs.len() + i) as u64);
        let ms = t0.elapsed().as_secs_f64() * 1e3;
        std::hint::black_box(proj);
        samples.push(ms);
    }

    let m = sweep_metrics(&obs);
    Ok(IncidentStability {
        final_top1_is_labeled: m
            .final_top1
            .as_ref()
            .is_some_and(|t| incident.labels.root_cause_services.contains(t)),
        incident_id: id,
        labeled_root_cause: incident.labels.root_cause_services.clone(),
        fault_start_ns: fault_start,
        start_ns: start,
        end_ns: end,
        cursors: obs.len(),
        first_nonempty_ranking_offset_s: m.first_nonempty_ranking_ns.map(offset),
        first_onset_cursor_offset_s: m.first_onset_cursor_ns.map(offset),
        top1_changes_after_first_ranking: m.top1_changes_after_first_ranking,
        final_top1: m.final_top1,
        final_top1_first_seen_offset_s: m.final_top1_first_seen_ns.map(offset),
        final_top1_stable_from_offset_s: m.final_top1_stable_from_ns.map(offset),
        flicker_count: m.flicker_count,
        onset_shift_count: m.onset_shift_count,
        last_cursor_call_ms: timing_stats(&samples),
        timeline: obs
            .iter()
            .map(|o| CursorSample {
                offset_s: offset(o.cursor_ns),
                top1: o.top1.clone(),
                candidates: o.candidates,
                services_with_onset: o.onsets.len(),
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn o(cursor: i64, top1: Option<&str>, onsets: &[(&str, i64)]) -> CursorObservation {
        CursorObservation {
            cursor_ns: cursor,
            top1: top1.map(str::to_owned),
            candidates: usize::from(top1.is_some()) * 3,
            onsets: onsets.iter().map(|(s, t)| ((*s).to_owned(), *t)).collect(),
        }
    }

    #[test]
    fn cursors_include_end() {
        assert_eq!(cursor_positions(0, 25, 10), vec![0, 10, 20, 25]);
        assert_eq!(cursor_positions(0, 20, 10), vec![0, 10, 20]);
        assert_eq!(cursor_positions(5, 5, 10), vec![5]);
    }

    #[test]
    fn sweep_counts_changes_flicker_and_stability() {
        let obs = vec![
            o(0, None, &[]),
            o(10, Some("a"), &[("a", 9)]),
            o(20, Some("b"), &[("a", 9), ("b", 15)]),
            o(30, Some("a"), &[("b", 15)]), // a's onset vanished: flicker 1
            o(40, Some("b"), &[("a", 35), ("b", 12)]), // b shifted
            o(50, Some("b"), &[("b", 12)]), // a vanished again: flicker 2
        ];
        let m = sweep_metrics(&obs);
        assert_eq!(m.first_nonempty_ranking_ns, Some(10));
        assert_eq!(m.first_onset_cursor_ns, Some(10));
        assert_eq!(m.top1_changes_after_first_ranking, 3);
        assert_eq!(m.final_top1.as_deref(), Some("b"));
        assert_eq!(m.final_top1_first_seen_ns, Some(20));
        assert_eq!(m.final_top1_stable_from_ns, Some(40));
        assert_eq!(m.flicker_count, 2);
        assert_eq!(m.onset_shift_count, 1);
    }

    #[test]
    fn timing_percentiles_nearest_rank() {
        let t = timing_stats(&[5.0, 1.0, 3.0, 2.0, 4.0]);
        assert_eq!(t.median_ms, 3.0);
        assert_eq!(t.p95_ms, 5.0);
        assert_eq!((t.min_ms, t.max_ms), (1.0, 5.0));
        let samples: Vec<f64> = (1..=20).map(f64::from).collect();
        let t = timing_stats(&samples);
        assert_eq!(t.p95_ms, 19.0);
        assert_eq!(t.median_ms, 10.5);
    }

    #[test]
    fn non_default_preset_is_refused() {
        let err = replay_stability(Path::new("/nonexistent"), "x", &[], "v2", 10, 1).unwrap_err();
        assert!(err.contains("not available"), "{err}");
    }

    #[test]
    fn replay_on_synthetic_fixture() {
        let root =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../datasets/fixtures");
        if !root.join("synthetic-ob/v1/rec-mem-001").exists() {
            return;
        }
        let r = replay_stability(
            &root,
            "synthetic-ob/v1",
            &["rec-mem-001".to_owned()],
            "legacy",
            60,
            3,
        )
        .unwrap();
        let i = &r.incidents[0];
        assert_eq!(i.cursors, i.timeline.len());
        assert_eq!(i.last_cursor_call_ms.samples, 3);
    }
}
