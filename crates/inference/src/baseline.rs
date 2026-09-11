//! Rolling robust baseline estimation (TA-030, spec 18.2).
//!
//! Rolling median and Median Absolute Deviation (MAD) per (service, metric)
//! key, with a robust z-score:
//!
//! ```text
//! z = (x - median) / sigma
//! sigma = max(spread, relative_scale_floor * |median|)
//! spread = MAD / 0.6745, else mean_abs_dev / 0.7979, else 0
//! ```
//!
//! The relative floor keeps a scrape-quantised series (values held between
//! scrapes, so MAD collapses to zero) from scoring a 1-3% step as a
//! saturated anomaly. It assumes metrics where zero is meaningful (cpu,
//! memory, latency, rates, counts): the floor is proportional to the
//! magnitude of the median, so a series centred on zero gets no floor.
//!
//! When sigma is zero (an all-zero window, or a flat window with the floor
//! disabled) a value equal to the median scores 0 and any other value scores
//! +/- `Z_SATURATION`. All estimates are deterministic functions of the
//! observed sequence.

use std::cmp::Ordering;
use std::collections::{BTreeMap, VecDeque};

use serde::{Deserialize, Serialize};

/// Consistency constant relating MAD to the standard deviation of a normal
/// distribution.
pub const MAD_NORMAL_CONSISTENCY: f64 = 0.6745;

/// Consistency constant for the mean-absolute-deviation fallback
/// (Iglewicz-Hoaglin modified z-score) used when MAD collapses to zero, which
/// happens on series where more than half the window shares one value.
pub const MEAN_AD_CONSISTENCY: f64 = 0.7979;

/// z-score assigned to a non-median value when every scale estimate is zero,
/// and the saturation bound applied to every reported z-score. Keeps a single
/// spike on a flat series from producing an unbounded score.
pub const Z_SATURATION: f64 = 8.0;

/// Zero test for the flat branch: with sigma zero, a deviation at or below
/// this is "equal to the median". With the relative floor on, sigma is zero
/// only for an all-zero window, so this is effectively an exact zero test.
const FLAT_EPSILON: f64 = 1e-9;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct BaselineConfig {
    /// Number of most recent samples retained per key.
    pub window_len: usize,
    /// Minimum samples before a baseline is considered warm. Below this,
    /// `robust_z` returns `None` and callers must not treat the point as
    /// anomalous.
    pub min_samples: usize,
    /// Lower bound on sigma as a fraction of |median|. 0 disables the floor
    /// (the legacy estimator). Must be finite and >= 0.
    #[serde(default)]
    pub relative_scale_floor: f64,
}

impl BaselineConfig {
    /// The original estimator: 32-sample window, no relative floor.
    pub fn legacy() -> Self {
        Self {
            window_len: 32,
            min_samples: 5,
            relative_scale_floor: 0.0,
        }
    }

    /// Long window with a 25% relative spread floor.
    pub fn v2() -> Self {
        Self {
            window_len: 300,
            min_samples: 5,
            relative_scale_floor: 0.25,
        }
    }
}

impl Default for BaselineConfig {
    fn default() -> Self {
        Self::v2()
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
///
/// Kept as a sorted vector plus an arrival-order queue so the median and MAD
/// are read without re-sorting on every sample. Values are finite and never
/// -0.0 (the store canonicalises before admission), so `total_cmp` order
/// matches numeric order and equal values are bitwise identical.
#[derive(Clone, Debug, Default)]
struct RollingWindow {
    sorted: Vec<f64>,
    /// (event_time_ns, value) in arrival order.
    arrivals: VecDeque<(i64, f64)>,
}

impl RollingWindow {
    fn push(&mut self, event_time_ns: i64, value: f64, cap: usize) {
        while self.arrivals.len() >= cap {
            let (_, old) = self.arrivals.pop_front().expect("window non-empty");
            let idx = self
                .sorted
                .partition_point(|v| v.total_cmp(&old) == Ordering::Less);
            debug_assert!(self.sorted[idx].to_bits() == old.to_bits());
            self.sorted.remove(idx);
        }
        let idx = self
            .sorted
            .partition_point(|v| v.total_cmp(&value) != Ordering::Greater);
        self.sorted.insert(idx, value);
        self.arrivals.push_back((event_time_ns, value));
    }

    fn oldest_time_ns(&self) -> Option<i64> {
        self.arrivals.front().map(|(t, _)| *t)
    }

    fn estimate(&self) -> Option<BaselineEstimate> {
        if self.sorted.is_empty() {
            return None;
        }
        let sorted = &self.sorted;
        let median = median_of_sorted(sorted);
        // Same summation order as the sort-based estimator: ascending values.
        let mean_abs_dev =
            sorted.iter().map(|v| (v - median).abs()).sum::<f64>() / sorted.len() as f64;
        Some(BaselineEstimate {
            median,
            mad: mad_of_sorted(sorted, median),
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

/// Median of |v - median| over a sorted, non-empty slice, without allocating.
///
/// Deviations are non-increasing walking left from the median and
/// non-decreasing walking right, so merging the two walks outward yields the
/// deviations in ascending order. The merge stops at the middle rank(s).
fn mad_of_sorted(s: &[f64], m: f64) -> f64 {
    let n = s.len();
    let p = s.partition_point(|v| *v < m);
    let (mut i, mut j) = (p, p);
    let (k_lo, k_hi) = ((n - 1) / 2, n / 2);
    let mut lo = 0.0;
    for k in 0..=k_hi {
        let left = i > 0 && (j == n || (s[i - 1] - m).abs() <= (s[j] - m).abs());
        let d = if left {
            i -= 1;
            (s[i] - m).abs()
        } else {
            j += 1;
            (s[j - 1] - m).abs()
        };
        if k == k_lo {
            lo = d;
        }
        if k == k_hi {
            return if n % 2 == 1 { d } else { (lo + d) / 2.0 };
        }
    }
    unreachable!("merge yields k_hi + 1 <= n deviations")
}

/// Scale-free spread of an estimate: MAD, else mean absolute deviation, each
/// converted to a normal-equivalent sigma; 0 when both collapse.
fn spread(e: &BaselineEstimate) -> f64 {
    if e.mad > 0.0 {
        e.mad / MAD_NORMAL_CONSISTENCY
    } else if e.mean_abs_dev > 0.0 {
        e.mean_abs_dev / MEAN_AD_CONSISTENCY
    } else {
        0.0
    }
}

/// Robust sigma: the spread, floored at `rel_floor * |median|`.
pub fn robust_scale(e: &BaselineEstimate, rel_floor: f64) -> f64 {
    debug_assert!(rel_floor.is_finite() && rel_floor >= 0.0);
    spread(e).max(rel_floor * e.median.abs())
}

/// Robust z-score against an estimate. `None` when the estimate is not warm.
///
/// Numerically `(x - median) / robust_scale(e, floor)`. When the spread is
/// not floored the legacy expression `c * (x - median) / scale` is evaluated
/// instead, so `relative_scale_floor = 0` reproduces the original scores bit
/// for bit.
pub fn robust_z(e: &BaselineEstimate, x: f64, cfg: &BaselineConfig) -> Option<f64> {
    if e.sample_count < cfg.min_samples {
        return None;
    }
    debug_assert!(cfg.relative_scale_floor.is_finite() && cfg.relative_scale_floor >= 0.0);
    let d = x - e.median;
    let spread = spread(e);
    let floor = cfg.relative_scale_floor * e.median.abs();
    let z = if spread > 0.0 && spread >= floor {
        if e.mad > 0.0 {
            MAD_NORMAL_CONSISTENCY * d / e.mad
        } else {
            MEAN_AD_CONSISTENCY * d / e.mean_abs_dev
        }
    } else if floor > 0.0 {
        d / floor
    } else if d.abs() <= FLAT_EPSILON {
        0.0
    } else {
        Z_SATURATION.copysign(d)
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
    /// Time from the oldest sample in the scoring window to this sample.
    /// `Some` exactly when `z` is.
    #[serde(default)]
    pub baseline_span_ns: Option<i64>,
}

/// Rolling robust baselines for many (service, metric) series.
#[derive(Clone, Debug)]
pub struct BaselineStore {
    config: BaselineConfig,
    windows: BTreeMap<SeriesKey, RollingWindow>,
}

impl BaselineStore {
    pub fn new(config: BaselineConfig) -> Self {
        debug_assert!(
            config.relative_scale_floor.is_finite() && config.relative_scale_floor >= 0.0,
            "relative_scale_floor must be finite and >= 0"
        );
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
    /// unwarmed and never admitted. -0.0 is canonicalised to +0.0.
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
                baseline_span_ns: None,
            };
        }
        let value = if value == 0.0 { 0.0 } else { value };
        let window = self.windows.entry(key.clone()).or_default();
        let estimate = window.estimate();
        let z = estimate
            .as_ref()
            .and_then(|e| robust_z(e, value, &self.config));
        let baseline_span_ns = match (z, window.oldest_time_ns()) {
            (Some(_), Some(oldest)) => Some(event_time_ns - oldest),
            _ => None,
        };
        window.push(event_time_ns, value, self.config.window_len.max(1));
        ScoredSample {
            event_time_ns,
            value,
            z,
            median: estimate.as_ref().map(|e| e.median),
            mad: estimate.as_ref().map(|e| e.mad),
            baseline_span_ns,
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

    fn floor0() -> BaselineConfig {
        BaselineConfig {
            min_samples: 5,
            relative_scale_floor: 0.0,
            ..BaselineConfig::default()
        }
    }

    #[test]
    fn warmup_returns_no_z() {
        let mut store = BaselineStore::new(BaselineConfig {
            window_len: 8,
            min_samples: 3,
            ..BaselineConfig::default()
        });
        let s1 = store.score_and_observe(&key(), 1, 10.0);
        let s2 = store.score_and_observe(&key(), 2, 11.0);
        assert_eq!(s1.z, None);
        assert_eq!(s2.z, None);
        let s3 = store.score_and_observe(&key(), 3, 10.5);
        // Only two samples admitted before this one: still below min_samples.
        assert_eq!(s3.z, None);
        assert_eq!(s3.baseline_span_ns, None);
    }

    #[test]
    fn robust_z_matches_formula() {
        let est = BaselineEstimate {
            median: 10.0,
            mad: 2.0,
            mean_abs_dev: 2.0,
            sample_count: 10,
        };
        let z = robust_z(&est, 14.0, &floor0()).unwrap();
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
        let z = robust_z(&est, 11.0, &floor0()).unwrap();
        assert!((z - 0.7979 * 1.0 / 0.5).abs() < 1e-12);
        // A near-median value on a mostly-flat series is not anomalous.
        assert!(z.abs() < 3.0);
    }

    #[test]
    fn relative_floor_dominates_small_spread() {
        let est = BaselineEstimate {
            median: 10.0,
            mad: 0.0,
            mean_abs_dev: 0.5,
            sample_count: 10,
        };
        // spread = 0.5 / 0.7979 = 0.627 < floor 0.25 * 10 = 2.5.
        let cfg = BaselineConfig::default();
        assert!((robust_scale(&est, cfg.relative_scale_floor) - 2.5).abs() < 1e-12);
        let z = robust_z(&est, 11.0, &cfg).unwrap();
        assert!((z - 0.4).abs() < 1e-12, "{z}");
    }

    #[test]
    fn fully_flat_series_is_explicit() {
        let cfg = BaselineConfig::default();
        let zero = BaselineEstimate {
            median: 0.0,
            mad: 0.0,
            mean_abs_dev: 0.0,
            sample_count: 10,
        };
        assert_eq!(robust_z(&zero, 0.0, &cfg), Some(0.0));
        assert_eq!(robust_z(&zero, 4.0, &cfg), Some(Z_SATURATION));
        assert_eq!(robust_z(&zero, -4.0, &cfg), Some(-Z_SATURATION));

        // A constant non-zero window is scaled by the floor: 0.25 * 5 = 1.25.
        let five = BaselineEstimate {
            median: 5.0,
            mad: 0.0,
            mean_abs_dev: 0.0,
            sample_count: 10,
        };
        assert_eq!(robust_z(&five, 5.0, &cfg), Some(0.0));
        let z = robust_z(&five, 9.0, &cfg).unwrap();
        assert!((z - 3.2).abs() < 1e-12, "{z}");
        // With the floor off the legacy flat branch still saturates.
        assert_eq!(robust_z(&five, 9.0, &floor0()), Some(Z_SATURATION));
    }

    #[test]
    fn z_is_saturated() {
        let est = BaselineEstimate {
            median: 10.0,
            mad: 0.001,
            mean_abs_dev: 0.001,
            sample_count: 10,
        };
        assert_eq!(robust_z(&est, 1000.0, &floor0()), Some(Z_SATURATION));
        assert_eq!(
            robust_z(&est, 1000.0, &BaselineConfig::default()),
            Some(Z_SATURATION)
        );
    }

    #[test]
    fn spike_scores_against_prior_baseline() {
        let mut store = BaselineStore::new(BaselineConfig {
            window_len: 32,
            min_samples: 5,
            ..BaselineConfig::default()
        });
        for i in 0..10 {
            store.score_and_observe(&key(), i, 10.0 + (i % 2) as f64);
        }
        let spike = store.score_and_observe(&key(), 100, 100.0);
        assert!(spike.z.unwrap() >= Z_SATURATION - 1e-9);
        // Scored against samples at t = 0..9.
        assert_eq!(spike.baseline_span_ns, Some(100));
    }

    #[test]
    fn window_rolls_forgetting_old_regime() {
        let mut store = BaselineStore::new(BaselineConfig {
            window_len: 4,
            min_samples: 2,
            ..BaselineConfig::default()
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
        // Span tracks the oldest retained sample, not the first ever seen.
        let s = store.score_and_observe(&key(), 12, 100.0);
        assert_eq!(s.baseline_span_ns, Some(4));
    }

    #[test]
    fn non_finite_rejected() {
        let mut store = BaselineStore::new(BaselineConfig::default());
        let s = store.score_and_observe(&key(), 1, f64::NAN);
        assert_eq!(s.z, None);
        assert!(store.estimate(&key()).is_none());
    }

    #[test]
    fn negative_zero_is_canonicalised() {
        let mut store = BaselineStore::new(BaselineConfig::default());
        for i in 0..6 {
            let v = if i % 2 == 0 { -0.0 } else { 0.0 };
            store.score_and_observe(&key(), i, v);
        }
        let est = store.estimate(&key()).unwrap();
        assert_eq!(est.median.to_bits(), 0.0f64.to_bits());
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

    /// The original sort-based estimator, kept as a reference.
    fn naive_estimate(values: &VecDeque<f64>) -> BaselineEstimate {
        let mut sorted: Vec<f64> = values.iter().copied().collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = median_of_sorted(&sorted);
        let mut deviations: Vec<f64> = sorted.iter().map(|v| (v - median).abs()).collect();
        let mean_abs_dev = deviations.iter().sum::<f64>() / deviations.len() as f64;
        deviations.sort_by(|a, b| a.partial_cmp(b).unwrap());
        BaselineEstimate {
            median,
            mad: median_of_sorted(&deviations),
            mean_abs_dev,
            sample_count: sorted.len(),
        }
    }

    #[test]
    fn sorted_window_matches_naive_reference() {
        // Tiny deterministic LCG (Numerical Recipes constants).
        let mut state: u64 = 0x5eed_f00d_dead_beef;
        let mut next = move || {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) as u32
        };
        let mut checked = 0usize;
        for &cap in &[1usize, 2, 3, 4, 5, 7, 8, 31, 32, 33, 64, 300] {
            for mode in 0..4 {
                let mut window = RollingWindow::default();
                let mut reference: VecDeque<f64> = VecDeque::new();
                for t in 0..(cap as i64 * 4 + 50) {
                    let r = next();
                    let v = match mode {
                        // Few distinct values: heavy duplicates.
                        0 => f64::from(r % 5) * 0.5,
                        // Held values with rare jumps, like scraped gauges.
                        1 => {
                            if r % 7 == 0 {
                                f64::from(r % 3) + 100.0
                            } else {
                                100.0
                            }
                        }
                        // Continuous values, including negatives.
                        2 => (f64::from(r) / f64::from(u32::MAX) - 0.4) * 1e3,
                        // Mostly zeros with occasional blips.
                        _ => {
                            if r % 11 == 0 {
                                f64::from(r % 97) * 0.01
                            } else {
                                0.0
                            }
                        }
                    };
                    window.push(t, v, cap);
                    if reference.len() == cap {
                        reference.pop_front();
                    }
                    reference.push_back(v);
                    let got = window.estimate().unwrap();
                    let want = naive_estimate(&reference);
                    assert_eq!(got.sample_count, want.sample_count);
                    assert_eq!(
                        got.median.to_bits(),
                        want.median.to_bits(),
                        "median cap={cap}"
                    );
                    assert_eq!(got.mad.to_bits(), want.mad.to_bits(), "mad cap={cap} t={t}");
                    assert_eq!(
                        got.mean_abs_dev.to_bits(),
                        want.mean_abs_dev.to_bits(),
                        "mean_abs_dev cap={cap}"
                    );
                    assert_eq!(window.arrivals.len(), window.sorted.len());
                    assert!(window.sorted.windows(2).all(|w| w[0] <= w[1]));
                    checked += 1;
                }
            }
        }
        assert!(checked > 5_000);
    }
}
