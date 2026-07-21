//! Heatmap projection: service × time buckets.

use faultline_common::{MetricPoint, TelemetryEnvelope, TelemetryPayload, TelemetrySignal};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HeatmapCell {
    pub service: String,
    pub bucket_start_ns: i64,
    pub value: f64,
    pub sample_count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HeatmapProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub bucket_width_ns: i64,
    pub cells: Vec<HeatmapCell>,
}

/// Precomputed heatmap from metric envelopes up to cursor.
pub fn build_heatmap(
    envelopes: &[TelemetryEnvelope],
    cursor_event_time_ns: i64,
    bucket_width_ns: i64,
    projection_version: u64,
) -> HeatmapProjection {
    let width = bucket_width_ns.max(1);
    let mut acc: IndexMap<(String, i64), (f64, u64)> = IndexMap::new();

    for env in envelopes
        .iter()
        .filter(|e| e.event_time_ns <= cursor_event_time_ns)
        .filter(|e| e.signal == TelemetrySignal::Metric)
    {
        let Some(service) = env.service.as_deref() else {
            continue;
        };
        let TelemetryPayload::Metric(MetricPoint { value, name, .. }) = &env.payload else {
            continue;
        };
        if !(name.contains("lat") || name.contains("err") || name.contains("mem")) {
            continue;
        }
        let bucket = (env.event_time_ns / width) * width;
        let entry = acc
            .entry((service.to_owned(), bucket))
            .or_insert((0.0, 0));
        entry.0 += *value;
        entry.1 += 1;
    }

    let mut cells: Vec<_> = acc
        .into_iter()
        .map(|((service, bucket_start_ns), (sum, sample_count))| HeatmapCell {
            service,
            bucket_start_ns,
            value: if sample_count > 0 {
                sum / sample_count as f64
            } else {
                0.0
            },
            sample_count,
        })
        .collect();
    cells.sort_by(|a, b| {
        a.service
            .cmp(&b.service)
            .then_with(|| a.bucket_start_ns.cmp(&b.bucket_start_ns))
    });

    HeatmapProjection {
        projection_version,
        cursor_event_time_ns,
        bucket_width_ns: width,
        cells,
    }
}
