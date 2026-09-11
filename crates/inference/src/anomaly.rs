//! Anomaly interval extraction with hysteresis (spec 18.1 mechanics).
//!
//! Consumes robust z-scores from [`crate::baseline`] and produces per-service
//! anomaly intervals. Hysteresis: an interval opens after `enter_count`
//! consecutive samples at `|z| >= enter_z` and closes after `exit_count`
//! consecutive samples at `|z| < exit_z`, so a single noisy sample neither
//! opens nor closes an incident.
//!
//! Persistence: an interval only counts toward onsets once it has stayed
//! anomalous for `required_persistence_ns = min(persistence_cap_ns,
//! baseline_span_ns)`, where the span is how much history scored its first
//! entering sample. A rolling median absorbs a step after roughly half a
//! window, so a short-history artefact closes before it qualifies while a
//! real shift against a long baseline stays open and qualifies. The rule is
//! causal: `qualified_ns` depends only on samples up to that time, so the set
//! of counted intervals on a growing prefix only grows.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::baseline::{BaselineConfig, BaselineStore, ScoredSample, SeriesKey};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnomalyConfig {
    pub baseline: BaselineConfig,
    /// |z| at or above which a sample counts toward opening an interval.
    pub enter_z: f64,
    /// |z| below which a sample counts toward closing an interval.
    pub exit_z: f64,
    /// Consecutive qualifying samples required to open.
    pub enter_count: usize,
    /// Consecutive qualifying samples required to close.
    pub exit_count: usize,
    /// Upper bound on how long an interval must persist before it counts
    /// toward onsets. 0 disables persistence (every interval qualifies at its
    /// first sample).
    #[serde(default)]
    pub persistence_cap_ns: i64,
}

impl AnomalyConfig {
    /// The original detector: legacy baseline, no persistence requirement.
    pub fn legacy() -> Self {
        Self {
            baseline: BaselineConfig::legacy(),
            enter_z: 3.0,
            exit_z: 1.5,
            enter_count: 2,
            exit_count: 2,
            persistence_cap_ns: 0,
        }
    }

    /// v2 baseline with a persistence cap of 120 s.
    pub fn v2() -> Self {
        Self {
            baseline: BaselineConfig::v2(),
            persistence_cap_ns: 120_000_000_000,
            ..Self::legacy()
        }
    }
}

impl Default for AnomalyConfig {
    fn default() -> Self {
        Self::v2()
    }
}

/// Whether the stream being analysed may still grow.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamHorizon {
    /// A prefix of a longer stream (live replay before the last event).
    Partial,
    /// The whole stream.
    Complete,
}

/// One contiguous anomalous stretch of a single (service, metric) series.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnomalyInterval {
    pub service: String,
    pub metric: String,
    /// Event time of the first sample that participated in opening the
    /// interval.
    pub start_ns: i64,
    /// Event time of the last anomalous sample (inclusive).
    pub end_ns: i64,
    pub peak_abs_z: f64,
    pub sample_count: u64,
    /// False when the series ended while still anomalous.
    pub closed: bool,
    /// Event ids of the samples inside the interval, for evidence refs.
    pub source_refs: Vec<String>,
    /// Baseline history behind the first entering sample.
    #[serde(default)]
    pub baseline_span_ns: i64,
    /// `min(persistence_cap_ns, baseline_span_ns)`.
    #[serde(default)]
    pub required_persistence_ns: i64,
    /// Event time of the first anomalous sample at which the interval had
    /// persisted `required_persistence_ns`. Set once, never cleared.
    #[serde(default)]
    pub qualified_ns: Option<i64>,
}

impl AnomalyInterval {
    /// Qualified intervals always count. On a complete stream an interval
    /// still open at the end also counts: it never got the chance to be
    /// absorbed or to close.
    pub fn counts_toward_onset(&self, horizon: StreamHorizon) -> bool {
        self.qualified_ns.is_some() || (horizon == StreamHorizon::Complete && !self.closed)
    }
}

/// Intervals that count toward onsets under `horizon`, order preserved.
pub fn qualifying_intervals(
    intervals: Vec<AnomalyInterval>,
    horizon: StreamHorizon,
) -> Vec<AnomalyInterval> {
    intervals
        .into_iter()
        .filter(|iv| iv.counts_toward_onset(horizon))
        .collect()
}

#[derive(Clone, Debug, Default)]
struct SeriesRun {
    open: Option<AnomalyInterval>,
    /// Pending samples counting toward opening: (time, |z|, event_id).
    entering: Vec<(i64, f64, String)>,
    /// Baseline span of the first entering sample.
    entering_span_ns: i64,
    exiting: usize,
}

/// Streaming detector over scored samples, keyed by (service, metric).
#[derive(Clone, Debug)]
pub struct AnomalyDetector {
    config: AnomalyConfig,
    store: BaselineStore,
    runs: BTreeMap<SeriesKey, SeriesRun>,
    finished: Vec<AnomalyInterval>,
}

impl AnomalyDetector {
    pub fn new(config: AnomalyConfig) -> Self {
        Self {
            config,
            store: BaselineStore::new(config.baseline),
            runs: BTreeMap::new(),
            finished: Vec::new(),
        }
    }

    /// Feed one observation. Samples must arrive in event-time order per key;
    /// the caller (projection layer) is responsible for ordering.
    pub fn observe(
        &mut self,
        key: &SeriesKey,
        event_time_ns: i64,
        value: f64,
        event_id: &str,
    ) -> ScoredSample {
        let scored = self.store.score_and_observe(key, event_time_ns, value);
        let Some(z) = scored.z else {
            return scored;
        };
        let cfg = self.config;
        let run = self.runs.entry(key.clone()).or_default();
        let abs_z = z.abs();

        if let Some(open) = run.open.as_mut() {
            if abs_z < cfg.exit_z {
                run.exiting += 1;
                if run.exiting >= cfg.exit_count {
                    let mut done = run.open.take().expect("open interval");
                    done.closed = true;
                    self.finished.push(done);
                    run.exiting = 0;
                }
            } else {
                run.exiting = 0;
                open.end_ns = event_time_ns;
                open.sample_count += 1;
                open.peak_abs_z = open.peak_abs_z.max(abs_z);
                open.source_refs.push(event_id.to_owned());
                if open.qualified_ns.is_none()
                    && event_time_ns - open.start_ns >= open.required_persistence_ns
                {
                    open.qualified_ns = Some(event_time_ns);
                }
            }
        } else if abs_z >= cfg.enter_z {
            if run.entering.is_empty() {
                run.entering_span_ns = scored.baseline_span_ns.unwrap_or(0);
            }
            run.entering
                .push((event_time_ns, abs_z, event_id.to_owned()));
            if run.entering.len() >= cfg.enter_count {
                let first = run.entering.first().expect("entering non-empty");
                let start_ns = first.0;
                let required_persistence_ns = cfg.persistence_cap_ns.min(run.entering_span_ns);
                let interval = AnomalyInterval {
                    service: key.service.clone(),
                    metric: key.metric.clone(),
                    start_ns,
                    end_ns: event_time_ns,
                    peak_abs_z: run.entering.iter().map(|(_, z, _)| *z).fold(0.0, f64::max),
                    sample_count: run.entering.len() as u64,
                    closed: false,
                    source_refs: run.entering.iter().map(|(_, _, id)| id.clone()).collect(),
                    baseline_span_ns: run.entering_span_ns,
                    required_persistence_ns,
                    qualified_ns: (event_time_ns - start_ns >= required_persistence_ns)
                        .then_some(event_time_ns),
                };
                run.open = Some(interval);
                run.entering.clear();
                run.exiting = 0;
            }
        } else {
            run.entering.clear();
        }
        scored
    }

    /// Finish the stream: intervals still open are emitted with
    /// `closed: false`. Returns all raw intervals, qualified or not, in
    /// deterministic order.
    pub fn finish(mut self) -> Vec<AnomalyInterval> {
        for (_, run) in std::mem::take(&mut self.runs) {
            if let Some(open) = run.open {
                self.finished.push(open);
            }
        }
        self.finished.sort_by(|a, b| {
            a.start_ns
                .cmp(&b.start_ns)
                .then_with(|| a.service.cmp(&b.service))
                .then_with(|| a.metric.cmp(&b.metric))
        });
        self.finished
    }
}

/// Earliest anomaly onset per service, in deterministic order.
pub fn onset_by_service(intervals: &[AnomalyInterval]) -> BTreeMap<String, i64> {
    let mut out: BTreeMap<String, i64> = BTreeMap::new();
    for iv in intervals {
        out.entry(iv.service.clone())
            .and_modify(|t| *t = (*t).min(iv.start_ns))
            .or_insert(iv.start_ns);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEC: i64 = 1_000_000_000;

    /// Short window and warm-up for hand-sized streams; v2 floor and
    /// persistence cap. Times in these streams are raw integers, so the
    /// baseline span (10 ns after 10 warm samples) bounds the requirement.
    fn cfg() -> AnomalyConfig {
        AnomalyConfig {
            baseline: BaselineConfig {
                window_len: 32,
                min_samples: 4,
                relative_scale_floor: 0.25,
            },
            enter_z: 3.0,
            exit_z: 1.5,
            enter_count: 2,
            exit_count: 2,
            persistence_cap_ns: 120 * SEC,
        }
    }

    fn key(service: &str) -> SeriesKey {
        SeriesKey {
            service: service.into(),
            metric: "mem".into(),
        }
    }

    fn feed(det: &mut AnomalyDetector, service: &str, points: &[(i64, f64)]) {
        for (t, v) in points {
            det.observe(&key(service), *t, *v, &format!("{service}-{t}"));
        }
    }

    fn run_default(values: &[f64]) -> Vec<AnomalyInterval> {
        let mut det = AnomalyDetector::new(AnomalyConfig::default());
        let pts: Vec<(i64, f64)> = values
            .iter()
            .enumerate()
            .map(|(i, v)| (i as i64 * SEC, *v))
            .collect();
        feed(&mut det, "svc", &pts);
        det.finish()
    }

    /// Values held for 5 samples, cycling through small scrape-level noise.
    fn held_series(n: usize, step_at: usize, factor: f64) -> Vec<f64> {
        const CYCLE: [f64; 6] = [100.0, 100.4, 99.7, 100.2, 99.9, 100.3];
        (0..n)
            .map(|i| {
                let v = CYCLE[(i / 5) % CYCLE.len()];
                if i >= step_at {
                    v * factor
                } else {
                    v
                }
            })
            .collect()
    }

    #[test]
    fn single_spike_does_not_open() {
        let mut det = AnomalyDetector::new(cfg());
        let mut pts: Vec<(i64, f64)> = (0..10).map(|i| (i, 10.0 + (i % 2) as f64)).collect();
        pts.push((10, 500.0));
        pts.extend((11..16).map(|i| (i, 10.0 + (i % 2) as f64)));
        feed(&mut det, "cart", &pts);
        assert!(det.finish().is_empty());
    }

    #[test]
    fn sustained_shift_opens_and_closes() {
        let mut det = AnomalyDetector::new(cfg());
        let mut pts: Vec<(i64, f64)> = (0..10).map(|i| (i, 10.0 + (i % 2) as f64)).collect();
        pts.extend((10..16).map(|i| (i, 500.0 + (i % 2) as f64)));
        pts.extend((16..24).map(|i| (i, 10.0 + (i % 2) as f64)));
        feed(&mut det, "cart", &pts);
        let intervals = det.finish();
        assert_eq!(intervals.len(), 1);
        let iv = &intervals[0];
        assert_eq!(iv.start_ns, 10);
        assert!(iv.closed);
        assert!(iv.peak_abs_z >= 3.0);
        assert!(!iv.source_refs.is_empty());
        // Ten samples of history: must persist 10 ns, but ends at 15.
        assert_eq!(iv.baseline_span_ns, 10);
        assert_eq!(iv.required_persistence_ns, 10);
        assert_eq!(iv.qualified_ns, None);
        assert!(!iv.counts_toward_onset(StreamHorizon::Complete));
    }

    #[test]
    fn open_at_stream_end_is_reported_unclosed() {
        let mut det = AnomalyDetector::new(cfg());
        let mut pts: Vec<(i64, f64)> = (0..10).map(|i| (i, 10.0 + (i % 2) as f64)).collect();
        pts.extend((10..16).map(|i| (i, 500.0 + (i % 2) as f64)));
        feed(&mut det, "cart", &pts);
        let intervals = det.finish();
        assert_eq!(intervals.len(), 1);
        assert!(!intervals[0].closed);
        assert_eq!(intervals[0].qualified_ns, None);
        assert!(intervals[0].counts_toward_onset(StreamHorizon::Complete));
        assert!(!intervals[0].counts_toward_onset(StreamHorizon::Partial));
    }

    #[test]
    fn onsets_take_earliest_interval() {
        let intervals = vec![
            AnomalyInterval {
                service: "a".into(),
                metric: "m1".into(),
                start_ns: 20,
                end_ns: 30,
                peak_abs_z: 4.0,
                sample_count: 3,
                closed: true,
                source_refs: vec![],
                baseline_span_ns: 20,
                required_persistence_ns: 0,
                qualified_ns: Some(21),
            },
            AnomalyInterval {
                service: "a".into(),
                metric: "m2".into(),
                start_ns: 10,
                end_ns: 15,
                peak_abs_z: 5.0,
                sample_count: 2,
                closed: true,
                source_refs: vec![],
                baseline_span_ns: 10,
                required_persistence_ns: 0,
                qualified_ns: Some(11),
            },
        ];
        let onsets = onset_by_service(&intervals);
        assert_eq!(onsets.get("a"), Some(&10));
    }

    #[test]
    fn legacy_preset_qualifies_every_interval_at_open() {
        let mut det = AnomalyDetector::new(AnomalyConfig::legacy());
        let mut pts: Vec<(i64, f64)> = (0..10).map(|i| (i, 10.0 + (i % 2) as f64)).collect();
        pts.extend((10..16).map(|i| (i, 500.0 + (i % 2) as f64)));
        pts.extend((16..24).map(|i| (i, 10.0 + (i % 2) as f64)));
        feed(&mut det, "cart", &pts);
        let intervals = det.finish();
        assert_eq!(intervals.len(), 1);
        assert_eq!(intervals[0].required_persistence_ns, 0);
        assert_eq!(intervals[0].qualified_ns, Some(11));
        assert!(intervals[0].counts_toward_onset(StreamHorizon::Partial));
    }

    #[test]
    fn held_two_percent_step_does_not_open() {
        let intervals = run_default(&held_series(400, 200, 1.02));
        assert!(intervals.is_empty(), "{intervals:?}");
    }

    #[test]
    fn sixfold_step_opens_and_qualifies() {
        let intervals = run_default(&held_series(400, 200, 6.0));
        assert_eq!(intervals.len(), 1, "{intervals:?}");
        let iv = &intervals[0];
        assert_eq!(iv.start_ns, 200 * SEC);
        assert_eq!(iv.baseline_span_ns, 200 * SEC);
        assert_eq!(iv.required_persistence_ns, 120 * SEC);
        assert_eq!(iv.qualified_ns, Some(320 * SEC));
        // The rolling median crosses into the new regime once half the
        // 300-sample window is post-step, at t = 350 s.
        assert_eq!(iv.end_ns, 349 * SEC);
        assert!(iv.closed);
    }

    #[test]
    fn zero_series_stepping_positive_opens() {
        let values: Vec<f64> = (0..400)
            .map(|i| if i >= 200 { 0.05 } else { 0.0 })
            .collect();
        let intervals = run_default(&values);
        assert_eq!(intervals.len(), 1, "{intervals:?}");
        let iv = &intervals[0];
        assert_eq!(iv.start_ns, 200 * SEC);
        assert_eq!(iv.qualified_ns, Some(320 * SEC));
    }

    #[test]
    fn warmup_step_is_absorbed_before_qualifying() {
        let intervals = run_default(&held_series(120, 40, 6.0));
        assert_eq!(intervals.len(), 1, "{intervals:?}");
        let iv = &intervals[0];
        assert_eq!(iv.start_ns, 40 * SEC);
        assert_eq!(iv.end_ns, 79 * SEC);
        assert_eq!(iv.required_persistence_ns, 40 * SEC);
        assert!(iv.closed);
        assert_eq!(iv.qualified_ns, None);
        assert!(qualifying_intervals(intervals, StreamHorizon::Complete).is_empty());
    }

    #[test]
    fn zero_median_blips_never_qualify() {
        // 5 s blips every 60 s on a zero series, starting after warm-up.
        let values: Vec<f64> = (0..400)
            .map(|i| if i >= 60 && i % 60 < 5 { 1.0 } else { 0.0 })
            .collect();
        let intervals = run_default(&values);
        assert_eq!(intervals.len(), 6, "{intervals:?}");
        for iv in &intervals {
            assert!(iv.closed);
            assert_eq!(iv.qualified_ns, None);
        }
        assert!(qualifying_intervals(intervals.clone(), StreamHorizon::Complete).is_empty());
        assert!(qualifying_intervals(intervals, StreamHorizon::Partial).is_empty());
    }
}
