//! Informal batch-size microbench. Do not publish résumé numbers from this file.

use std::time::Instant;

use faultline_common::{
    EventId, MetricKind, MetricPoint, TelemetryEnvelope, TelemetryPayload, TelemetrySignal,
    SCHEMA_VERSION,
};
use faultline_ingest::{partition_key_for, BatcherConfig, IngestedEvent, SignalBatcher, SignalKind};
use indexmap::IndexMap;

fn metric(i: usize) -> IngestedEvent {
    let envelope = TelemetryEnvelope {
        schema_version: SCHEMA_VERSION,
        event_id: EventId::new(format!("m{i}")),
        event_time_ns: i as i64 * 1_000,
        observed_time_ns: i as i64 * 1_000,
        ingest_time_ns: 0,
        source_id: "bench".into(),
        dataset_id: "bench".into(),
        incident_id: None,
        environment: "bench".into(),
        service: Some("frontend".into()),
        service_instance: None,
        host: None,
        region: None,
        signal: TelemetrySignal::Metric,
        attributes: IndexMap::new(),
        payload: TelemetryPayload::Metric(MetricPoint {
            name: "frontend_lat".into(),
            kind: MetricKind::Gauge,
            value: 1.0,
            unit: None,
        }),
    };
    IngestedEvent {
        sequence: i as u64 + 1,
        partition_key: partition_key_for(&envelope),
        envelope,
    }
}

fn main() {
    for max_rows in [16usize, 64, 256, 1024] {
        let mut b = SignalBatcher::new(
            SignalKind::Metrics,
            BatcherConfig {
                max_rows,
                ..Default::default()
            },
        );
        let start = Instant::now();
        let mut flushes = 0u64;
        for i in 0..10_000 {
            if b.push(metric(i)).unwrap().is_some() {
                flushes += 1;
            }
        }
        let _ = b.flush_control();
        println!(
            "max_rows={max_rows} flushes={flushes} elapsed_ms={}",
            start.elapsed().as_millis()
        );
    }
}
