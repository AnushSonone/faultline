//! End-to-end streaming heatmap path: watermark → batch → filter → window → sink.

use faultline_common::TelemetryEnvelope;
use faultline_ingest::{
    ingested, partition_key_for, BatcherConfig, MultiSignalBatcher, SignalKind, WatermarkConfig,
    WatermarkTracker,
};
use faultline_projection::HeatmapProjection;
use serde::{Deserialize, Serialize};

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::Operator;
use crate::operators::filter::{FilterExec, Predicate};
use crate::operators::heatmap_sink::HeatmapSinkExec;
use crate::operators::window::{WindowKind, WindowOperator};
use crate::runtime::RuntimeInspectorDto;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionMode {
    #[default]
    Precomputed,
    Streaming,
}

pub struct HeatmapStreamingPipeline {
    watermark: WatermarkTracker,
    batcher: MultiSignalBatcher,
    filter: FilterExec,
    window: WindowOperator,
    sink: HeatmapSinkExec,
    next_seq: u64,
    mode: ProjectionMode,
    cursor_ns: i64,
}

impl HeatmapStreamingPipeline {
    pub fn new(mode: ProjectionMode) -> Self {
        let wm_cfg = WatermarkConfig {
            allowed_lateness_ns: 2_000_000_000,
            late_revision_grace_ns: 1_000_000_000,
            idle_timeout_ns: 30_000_000_000,
            max_reorder_buffer: 50_000,
            ..Default::default()
        };
        Self {
            watermark: WatermarkTracker::new(wm_cfg),
            batcher: MultiSignalBatcher::new(BatcherConfig {
                max_rows: 64,
                max_bytes: 1 << 20,
                max_age_ns: i64::MAX / 4,
            }),
            filter: FilterExec::new(
                "filter_lat_err_mem",
                Predicate::Or(
                    Box::new(Predicate::NameContains("lat".into())),
                    Box::new(Predicate::Or(
                        Box::new(Predicate::NameContains("err".into())),
                        Box::new(Predicate::NameContains("mem".into())),
                    )),
                ),
            ),
            window: WindowOperator::new(
                "heatmap_tumbling",
                "heatmap_svc_time",
                WindowKind::Tumbling {
                    size_ns: 1_000_000_000,
                },
                1_000_000_000,
            ),
            sink: HeatmapSinkExec::new("heatmap_sink", 1_000_000_000),
            next_seq: 1,
            mode,
            cursor_ns: 0,
        }
    }

    pub fn mode(&self) -> ProjectionMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: ProjectionMode) {
        self.mode = mode;
    }

    pub fn reset(&mut self) {
        self.watermark.reset();
        self.batcher.reset();
        let _ = self.filter.on_control(&ControlMessage::Reset);
        let _ = self.window.on_control(&ControlMessage::Reset);
        let _ = self.sink.on_control(&ControlMessage::Reset);
        self.next_seq = 1;
        self.cursor_ns = 0;
    }

    /// Rebuild streaming heatmap from envelopes with event_time <= cursor.
    pub fn rebuild_until(
        &mut self,
        envelopes: &[TelemetryEnvelope],
        cursor_ns: i64,
    ) -> Result<HeatmapProjection, String> {
        self.reset();
        self.cursor_ns = cursor_ns;
        self.watermark.advance_processing_time(cursor_ns);
        self.batcher.set_processing_time(cursor_ns);

        for env in envelopes.iter().filter(|e| e.event_time_ns <= cursor_ns) {
            let seq = self.next_seq;
            self.next_seq += 1;
            let event = ingested(seq, partition_key_for(env), env.clone());
            let (_class, released) = self
                .watermark
                .push(event)
                .map_err(|e| e.to_string())?;
            for r in released {
                self.ingest_released(r)?;
            }
        }
        // End of partial source at cursor: flush buffers and advance watermark.
        for r in self.watermark.drain_all() {
            self.ingest_released(r)?;
        }
        for batch in self.batcher.flush_all().map_err(|e| e.to_string())? {
            self.run_batch(batch, cursor_ns)?;
        }
        let wm = if cursor_ns > 0 {
            cursor_ns
        } else {
            self.watermark.global_watermark_ns()
        };
        let _ = self.window.on_watermark(wm);
        self.sink
            .apply_emits(self.window.last_emits(), cursor_ns);
        Ok(self
            .sink
            .last_projection()
            .cloned()
            .unwrap_or(HeatmapProjection {
                projection_version: 1,
                cursor_event_time_ns: cursor_ns,
                bucket_width_ns: 1_000_000_000,
                cells: Vec::new(),
            }))
    }

    fn ingest_released(&mut self, event: faultline_ingest::IngestedEvent) -> Result<(), String> {
        if SignalKind::from_envelope(&event.envelope) != Some(SignalKind::Metrics) {
            return Ok(());
        }
        for batch in self.batcher.push(event).map_err(|e| e.to_string())? {
            let wm = self.watermark.global_watermark_ns();
            self.run_batch(batch, wm)?;
        }
        Ok(())
    }

    fn run_batch(
        &mut self,
        batch: faultline_ingest::SignalBatch,
        watermark_hint: i64,
    ) -> Result<(), String> {
        let rt = RuntimeBatch {
            signal: batch.kind,
            batch: batch.batch,
            watermark_ns: Some(watermark_hint),
        };
        let filtered = self.filter.on_batch(rt).map_err(|e| e.to_string())?;
        for b in filtered {
            let _ = self.window.on_batch(b).map_err(|e| e.to_string())?;
            self.sink
                .apply_emits(self.window.last_emits(), self.cursor_ns);
        }
        Ok(())
    }

    pub fn inspector(&self) -> RuntimeInspectorDto {
        let wm = self.watermark.metrics();
        RuntimeInspectorDto {
            global_watermark_ns: wm.global_watermark_ns,
            allowed_lateness_ns: self.watermark.config().allowed_lateness_ns,
            late_events: wm.late_events,
            reorder_buffer_size: wm.reorder_buffer_size,
            operators: vec![
                self.filter.metrics(),
                self.window.metrics(),
                self.sink.metrics(),
            ],
            active_window_count: self.window.active_window_count(),
            finalized_window_count: self.window.finalized_window_count(),
            heatmap_revisions: self.sink.revisions(),
            projection_mode: format!("{:?}", self.mode).to_ascii_lowercase(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use faultline_common::{
        EventId, MetricKind, MetricPoint, TelemetryPayload, TelemetrySignal, SCHEMA_VERSION,
    };
    use indexmap::IndexMap;

    fn metric(id: &str, t: i64, svc: &str, name: &str, value: f64) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(id),
            event_time_ns: t,
            observed_time_ns: t,
            ingest_time_ns: 0,
            source_id: "t".into(),
            dataset_id: "d".into(),
            incident_id: None,
            environment: "test".into(),
            service: Some(svc.into()),
            service_instance: None,
            host: None,
            region: None,
            signal: TelemetrySignal::Metric,
            attributes: IndexMap::new(),
            payload: TelemetryPayload::Metric(MetricPoint {
                name: name.into(),
                kind: MetricKind::Gauge,
                value,
                unit: Some("ms".into()),
            }),
        }
    }

    #[test]
    fn streaming_heatmap_produces_cells() {
        let mut p = HeatmapStreamingPipeline::new(ProjectionMode::Streaming);
        let envs = vec![
            metric("a", 1_000_000_000, "frontend", "frontend_lat", 10.0),
            metric("b", 1_500_000_000, "frontend", "frontend_lat", 20.0),
            metric("c", 2_000_000_000, "checkout", "checkout_lat", 30.0),
        ];
        let heat = p.rebuild_until(&envs, 3_000_000_000).unwrap();
        assert!(!heat.cells.is_empty());
        assert!(heat.cells.iter().any(|c| c.service == "frontend"));
    }

    #[test]
    fn seek_rebuild_is_deterministic() {
        let envs = vec![
            metric("a", 1_000_000_000, "frontend", "frontend_lat", 10.0),
            metric("b", 2_000_000_000, "frontend", "frontend_lat", 40.0),
        ];
        let mut p = HeatmapStreamingPipeline::new(ProjectionMode::Streaming);
        let a = p.rebuild_until(&envs, 2_500_000_000).unwrap();
        let b = p.rebuild_until(&envs, 2_500_000_000).unwrap();
        assert_eq!(a.cells, b.cells);
    }
}
