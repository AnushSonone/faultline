//! Anomaly interval extraction with hysteresis (spec 18.1 mechanics).
//!
//! Consumes robust z-scores from [`crate::baseline`] and produces per-service
//! anomaly intervals. Hysteresis: an interval opens after `enter_count`
//! consecutive samples at `|z| >= enter_z` and closes after `exit_count`
//! consecutive samples at `|z| < exit_z`, so a single noisy sample neither
//! opens nor closes an incident.

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
}

impl Default for AnomalyConfig {
    fn default() -> Self {
        Self {
            baseline: BaselineConfig::default(),
            enter_z: 3.0,
            exit_z: 1.5,
            enter_count: 2,
            exit_count: 2,
        }
    }
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
}

#[derive(Clone, Debug, Default)]
struct SeriesRun {
    open: Option<AnomalyInterval>,
    /// Pending samples counting toward opening: (time, |z|, event_id).
    entering: Vec<(i64, f64, String)>,
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
            }
        } else if abs_z >= cfg.enter_z {
            run.entering
                .push((event_time_ns, abs_z, event_id.to_owned()));
            if run.entering.len() >= cfg.enter_count {
                let first = run.entering.first().expect("entering non-empty");
                let interval = AnomalyInterval {
                    service: key.service.clone(),
                    metric: key.metric.clone(),
                    start_ns: first.0,
                    end_ns: event_time_ns,
                    peak_abs_z: run.entering.iter().map(|(_, z, _)| *z).fold(0.0, f64::max),
                    sample_count: run.entering.len() as u64,
                    closed: false,
                    source_refs: run.entering.iter().map(|(_, _, id)| id.clone()).collect(),
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
    /// `closed: false`. Returns all intervals in deterministic order.
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

    fn cfg() -> AnomalyConfig {
        AnomalyConfig {
            baseline: BaselineConfig {
                window_len: 32,
                min_samples: 4,
            },
            enter_z: 3.0,
            exit_z: 1.5,
            enter_count: 2,
            exit_count: 2,
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
            },
        ];
        let onsets = onset_by_service(&intervals);
        assert_eq!(onsets.get("a"), Some(&10));
    }
}
