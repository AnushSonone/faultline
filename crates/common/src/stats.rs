//! Small shared numeric helpers.

/// Exact percentile on a sorted ascending slice (linear interpolation on rank).
pub fn exact_percentile_sorted(sorted: &[f64], q: f64) -> Option<f64> {
    if sorted.is_empty() || !(0.0..=1.0).contains(&q) {
        return None;
    }
    if sorted.len() == 1 {
        return Some(sorted[0]);
    }
    let rank = q * (sorted.len() as f64 - 1.0);
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    if lo == hi {
        Some(sorted[lo])
    } else {
        let w = rank - lo as f64;
        Some(sorted[lo] * (1.0 - w) + sorted[hi] * w)
    }
}

/// Exact percentile on unsorted values: sorts a copy, then interpolates.
pub fn exact_percentile(vals: &[f64], q: f64) -> Option<f64> {
    if vals.is_empty() {
        return None;
    }
    let mut v = vals.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    exact_percentile_sorted(&v, q)
}
