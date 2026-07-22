//! Percentile accuracy vs exact sorted reference (TA-026).

use faultline_engine::{
    exact_percentile_sorted, BoundedPercentileSketch, PercentileKind, ACCEPTABLE_RELATIVE_ERROR,
};

fn report(name: &str, values: &[f64]) -> Vec<(String, f64, f64, f64, f64, usize)> {
    let mut sketch = BoundedPercentileSketch::new(0.01);
    let mut exact = values.to_vec();
    for v in values {
        sketch.add(*v);
    }
    exact.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut rows = Vec::new();
    for p in PercentileKind::all() {
        let est = sketch.quantile(p.quantile()).unwrap_or(0.0);
        let truth = exact_percentile_sorted(&exact, p.quantile()).unwrap_or(0.0);
        let abs = (est - truth).abs();
        let rel = if truth.abs() < 1e-12 {
            abs
        } else {
            abs / truth.abs()
        };
        rows.push((
            format!("{name}/{}", p.label()),
            est,
            truth,
            abs,
            rel,
            sketch.state_bytes(),
        ));
        let span = exact.last().copied().unwrap_or(0.0) - exact.first().copied().unwrap_or(0.0);
        let ok = if values.len() < 20 {
            // Tiny windows: require estimate inside data range and abs error ≤ 25% of span.
            est >= exact[0] - 1e-6
                && est <= exact[exact.len() - 1] + 1e-6
                && (span == 0.0 || abs <= span * 0.25 + 1.0)
        } else {
            rel <= ACCEPTABLE_RELATIVE_ERROR * 2.5 || abs <= 1.0
        };
        assert!(
            ok,
            "{name} {} rel={rel} abs={abs} est={est} truth={truth} n={}",
            p.label(),
            values.len()
        );
    }
    rows
}

#[test]
fn accuracy_matrix() {
    let mut all = Vec::new();
    all.extend(report(
        "uniform",
        &(1..=2_000).map(|i| i as f64).collect::<Vec<_>>(),
    ));
    // Normal-like via Box-Muller light approximation
    let normal: Vec<f64> = (0..2_000)
        .map(|i| {
            let u = (i as f64 + 1.0) / 2001.0;
            let z = (u.ln().abs()).sqrt() * if i % 2 == 0 { 1.0 } else { -1.0 };
            100.0 + z * 15.0
        })
        .collect();
    all.extend(report("normalish", &normal));
    let skewed: Vec<f64> = (0..2_000)
        .map(|i| 10.0 + (i as f64).powf(1.7) / 100.0)
        .collect();
    all.extend(report("skewed", &skewed));
    let heavy: Vec<f64> = (0..2_000)
        .map(|i| {
            if i % 50 == 0 {
                10_000.0 + i as f64
            } else {
                20.0 + (i % 30) as f64
            }
        })
        .collect();
    all.extend(report("heavy_tail", &heavy));
    all.extend(report("identical", &vec![42.0; 500]));
    all.extend(report("small", &[10.0, 11.0, 12.0, 13.0, 14.0, 15.0]));
    all.extend(report(
        "large",
        &(0..20_000).map(|i| (i % 997) as f64).collect::<Vec<_>>(),
    ));
    let mut outliers = (0..1_000).map(|i| i as f64).collect::<Vec<_>>();
    outliers.push(1_000_000.0);
    all.extend(report("outliers", &outliers));

    // Throughput smoke (not a published claim).
    let mut s = BoundedPercentileSketch::new(0.01);
    let t0 = std::time::Instant::now();
    for i in 0..100_000 {
        s.add((i % 10_000) as f64);
    }
    let elapsed = t0.elapsed();
    assert!(elapsed.as_secs_f64() < 5.0);
    assert!(s.state_bytes() < 64 * 1024);
    let _ = all;
}
