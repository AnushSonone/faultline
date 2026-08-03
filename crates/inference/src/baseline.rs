//! Rolling robust baseline estimation (TA-030, spec 18.2).
//!
//! Rolling median and Median Absolute Deviation (MAD) per (service, metric)
//! key, with a robust z-score:
//!
//! ```text
//! z = 0.6745 * (x - median) / MAD
//! ```
//!
//! MAD = 0 is handled explicitly: a value equal to the median scores 0, any
//! other value scores +/- `Z_SATURATION`. All estimates are deterministic
//! functions of the observed sequence.

use std::collections::{BTreeMap, VecDeque};

use serde::{Deserialize, Serialize};

/// Consistency constant relating MAD to the standard deviation of a normal
/// distribution.
pub const MAD_NORMAL_CONSISTENCY: f64 = 0.6745;

/// Consistency constant for the mean-absolute-deviation fallback
/// (Iglewicz-Hoaglin modified z-score) used when MAD collapses to zero, which
/// happens on series where more than half the window shares one value.
pub const MEAN_AD_CONSISTENCY: f64 = 0.7979;

/// z-score assigned to a non-median value when both scale estimates collapse
/// to zero, and the saturation bound applied to every reported z-score. Keeps
/// a single spike on a flat series from producing an unbounded score.
pub const Z_SATURATION: f64 = 8.0;

/// Absolute tolerance for treating a value as equal to the median when both
/// scale estimates are zero.
const FLAT_EPSILON: f64 = 1e-9;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaselineConfig {
    /// Number of most recent samples retained per key.
    pub window_len: usize,
    /// Minimum samples before a baseline is considered warm. Below this,
    /// `robust_z` returns `None` and callers must not treat the point as
    /// anomalous.
    pub min_samples: usize,
}

impl Default for BaselineConfig {
    fn default() -> Self {
        Self {
            window_len: 32,
            min_samples: 5,
        }
    }
}

/// Point-in-time robust estimate for one key.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaselineEstimate {
    pub median: f64,
    pub mad: f64,
    /// Mean absolute deviation from the median: fallback scale when MAD is 0.
    pub mean_abs_dev: f64,
    pub sample_count: usize,
}

/// Rolling window of samples for one (service, metric) key.
#[derive(Clone, Debug, Default)]
struct RollingWindow {
    values: VecDeque<f64>,
}

impl RollingWindow {
    fn push(&mut self, value: f64, cap: usize) {
        if self.values.len() == cap {
            self.values.pop_front();
        }
        self.values.push_back(value);
    }

    fn estimate(&self) -> Option<BaselineEstimate> {
        if self.values.is_empty() {
            return None;
        }
        let mut sorted: Vec<f64> = self.values.iter().copied().collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).expect("baseline values are finite"));
        let median = median_of_sorted(&sorted);
        let mut deviations: Vec<f64> = sorted.iter().map(|v| (v - median).abs()).collect();
        let mean_abs_dev = deviations.iter().sum::<f64>() / deviations.len() as f64;
        deviations.sort_by(|a, b| a.partial_cmp(b).expect("deviations are finite"));
        Some(BaselineEstimate {
            median,
            mad: median_of_sorted(&deviations),
            mean_abs_dev,
            sample_count: sorted.len(),
        })
    }
}

fn median_of_sorted(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

/// Robust z-score against an estimate. `None` when the estimate is not warm.
pub fn robust_z(estimate: &BaselineEstimate, x: f64, min_samples: usize) -> Option<f64> {
    if estimate.sample_count < min_samples {
        return None;
    }
    let z = if estimate.mad > 0.0 {
        MAD_NORMAL_CONSISTENCY * (x - estimate.median) / estimate.mad
    } else if estimate.mean_abs_dev > 0.0 {
        MEAN_AD_CONSISTENCY * (x - estimate.median) / estimate.mean_abs_dev
    } else if (x - estimate.median).abs() <= FLAT_EPSILON {
        0.0
    } else if x > estimate.median {
        Z_SATURATION
    } else {
        -Z_SATURATION
    };
    Some(z.clamp(-Z_SATURATION, Z_SATURATION))
}

/// Key for one baseline series.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SeriesKey {
    pub service: String,
    pub metric: String,
}

/// A scored observation: z computed against the baseline as it stood *before*
/// the observation was admitted, so a sample never dilutes its own score.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScoredSample {
    pub event_time_ns: i64,
    pub value: f64,
    /// `None` while the baseline is still warming up.
    pub z: Option<f64>,
    pub median: Option<f64>,
    pub mad: Option<f64>,
}

/// Rolling robust baselines for many (service, metric) series.
#[derive(Clone, Debug)]
pub struct BaselineStore {
    config: BaselineConfig,
    windows: BTreeMap<SeriesKey, RollingWindow>,
}

impl BaselineStore {
    pub fn new(config: BaselineConfig) -> Self {
        Self {
            config,
            windows: BTreeMap::new(),
        }
    }

    pub fn config(&self) -> BaselineConfig {
        self.config
    }

    /// Score `value` against the pre-existing baseline for `key`, then admit
    /// it into the rolling window. Non-finite values are rejected: scored as
    /// unwarmed and never admitted.
    pub fn score_and_observe(
        &mut self,
        key: &SeriesKey,
        event_time_ns: i64,
        value: f64,
    ) -> ScoredSample {
        if !value.is_finite() {
            return ScoredSample {
                event_time_ns,
                value,
                z: None,
                median: None,
                mad: None,
            };
        }
        let window = self.windows.entry(key.clone()).or_default();
        let estimate = window.estimate();
        let z = estimate
            .as_ref()
            .and_then(|e| robust_z(e, value, self.config.min_samples));
        window.push(value, self.config.window_len.max(1));
        ScoredSample {
            event_time_ns,
            value,
            z,
            median: estimate.as_ref().map(|e| e.median),
            mad: estimate.as_ref().map(|e| e.mad),
        }
    }

    /// Current estimate for a key, if any samples were admitted.
    pub fn estimate(&self, key: &SeriesKey) -> Option<BaselineEstimate> {
        self.windows.get(key).and_then(RollingWindow::estimate)
    }

    /// Keys with at least one admitted sample, in deterministic order.
    pub fn keys(&self) -> impl Iterator<Item = &SeriesKey> {
        self.windows.keys()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> SeriesKey {
        SeriesKey {
            service: "cart".into(),
            metric: "latency_ms".into(),
        }
    }

    #[test]
    fn warmup_returns_no_z() {
        let mut store = BaselineStore::new(BaselineConfig {
            window_len: 8,
            min_samples: 3,
        });
        let s1 = store.score_and_observe(&key(), 1, 10.0);
        let s2 = store.score_and_observe(&key(), 2, 11.0);
        assert_eq!(s1.z, None);
        assert_eq!(s2.z, None);
        let s3 = store.score_and_observe(&key(), 3, 10.5);
        // Only two samples admitted before this one: still below min_samples.
        assert_eq!(s3.z, None);
    }

    #[test]
    fn robust_z_matches_formula() {
        let est = BaselineEstimate {
            median: 10.0,
            mad: 2.0,
            mean_abs_dev: 2.0,
            sample_count: 10,
        };
        let z = robust_z(&est, 14.0, 5).unwrap();
        assert!((z - 0.6745 * 4.0 / 2.0).abs() < 1e-12);
    }

    #[test]
    fn mad_zero_falls_back_to_mean_abs_dev() {
        let est = BaselineEstimate {
            median: 10.0,
            mad: 0.0,
            mean_abs_dev: 0.5,
            sample_count: 10,
        };
        let z = robust_z(&est, 11.0, 5).unwrap();
        assert!((z - 0.7979 * 1.0 / 0.5).abs() < 1e-12);
        // A near-median value on a mostly-flat series is not anomalous.
        assert!(z.abs() < 3.0);
    }

    #[test]
    fn fully_flat_series_is_explicit() {
        let est = BaselineEstimate {
            median: 5.0,
            mad: 0.0,
            mean_abs_dev: 0.0,
            sample_count: 10,
        };
        assert_eq!(robust_z(&est, 5.0, 5), Some(0.0));
        assert_eq!(robust_z(&est, 9.0, 5), Some(Z_SATURATION));
        assert_eq!(robust_z(&est, 1.0, 5), Some(-Z_SATURATION));
    }

    #[test]
    fn z_is_saturated() {
        let est = BaselineEstimate {
            median: 10.0,
            mad: 0.001,
            mean_abs_dev: 0.001,
            sample_count: 10,
        };
        assert_eq!(robust_z(&est, 1000.0, 5), Some(Z_SATURATION));
    }

    #[test]
    fn spike_scores_against_prior_baseline() {
        let mut store = BaselineStore::new(BaselineConfig {
            window_len: 32,
            min_samples: 5,
        });
        for i in 0..10 {
            store.score_and_observe(&key(), i, 10.0 + (i % 2) as f64);
        }
        let spike = store.score_and_observe(&key(), 100, 100.0);
        assert!(spike.z.unwrap() >= Z_SATURATION - 1e-9);
    }

    #[test]
    fn window_rolls_forgetting_old_regime() {
        let mut store = BaselineStore::new(BaselineConfig {
            window_len: 4,
            min_samples: 2,
        });
        for i in 0..8 {
            store.score_and_observe(&key(), i, 1.0);
        }
        // Shift regime; after window_len samples the old values are gone.
        for i in 8..12 {
            store.score_and_observe(&key(), i, 100.0 + (i % 2) as f64);
        }
        let est = store.estimate(&key()).unwrap();
        assert!(est.median >= 100.0);
    }

    #[test]
    fn non_finite_rejected() {
        let mut store = BaselineStore::new(BaselineConfig::default());
        let s = store.score_and_observe(&key(), 1, f64::NAN);
        assert_eq!(s.z, None);
        assert!(store.estimate(&key()).is_none());
    }

    #[test]
    fn deterministic_across_runs() {
        let run = || {
            let mut store = BaselineStore::new(BaselineConfig::default());
            let mut out = Vec::new();
            for i in 0..50 {
                let v = ((i * 7919) % 23) as f64;
                out.push(store.score_and_observe(&key(), i, v));
            }
            serde_json::to_string(&out).unwrap()
        };
        assert_eq!(run(), run());
    }
}
