//! End-to-end streaming heatmap + percentile + temporal-join path.

use faultline_common::{TelemetryEnvelope, TelemetryPayload};
use faultline_ingest::{
    ingested, partition_key_for, BatcherConfig, MultiSignalBatcher, SignalKind, WatermarkConfig,
    WatermarkTracker,
};
use faultline_projection::{
    build_correlation_from_emits, CorrelationProjection, HeatmapProjection, JoinEvidenceInput,
    PercentileWindowInput,
};
use serde::{Deserialize, Serialize};

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::Operator;
use crate::operators::filter::{FilterExec, Predicate};
use crate::operators::heatmap_sink::HeatmapSinkExec;
use crate::operators::percentile::{PercentileEmit, PercentileOperator};
use crate::operators::temporal_join::TemporalIntervalJoin;
use crate::operators::window::{WindowKind, WindowOperator};
use crate::runtime_projection::{
    default_architecture_status, BackpressureStats, BatchingStats, EventTimeStats, IngestionStats,
    OperatorNode, PartitionWatermark, PercentileOperatorStats, RuntimeInspectorDto,
    SessionRuntimeStats, SignalCount, TemporalJoinOperatorStats, RUNTIME_PROJECTION_VERSION,
};

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
    percentile: PercentileOperator,
    join: TemporalIntervalJoin,
    sink: HeatmapSinkExec,
    next_seq: u64,
    mode: ProjectionMode,
    cursor_ns: i64,
    last_correlation: Option<CorrelationProjection>,
    events_received: u64,
    duplicates: u64,
    invalid_events: u64,
    signal_counts: [u64; 4],
    max_event_time_ns: i64,
    session_uptime_ms: u64,
    websocket_clients: usize,
    resync_count: u64,
    replay_state: String,
    replay_speed: String,
    projection_versions: u64,
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
            percentile: PercentileOperator::new(
                "latency_percentile",
                "heatmap_p99",
                WindowKind::Tumbling {
                    size_ns: 1_000_000_000,
                },
                1_000_000_000,
            ),
            join: TemporalIntervalJoin::new(
                "deploy_temporal_join",
                "deploy_correlation",
                5_000_000_000,
                10_000_000_000,
                1_000_000_000,
            ),
            sink: HeatmapSinkExec::new("heatmap_sink", 1_000_000_000),
            next_seq: 1,
            mode,
            cursor_ns: 0,
            last_correlation: None,
            events_received: 0,
            duplicates: 0,
            invalid_events: 0,
            signal_counts: [0; 4],
            max_event_time_ns: i64::MIN,
            session_uptime_ms: 0,
            websocket_clients: 0,
            resync_count: 0,
            replay_state: "stopped".into(),
            replay_speed: "1".into(),
            projection_versions: 0,
        }
    }

    pub fn mode(&self) -> ProjectionMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: ProjectionMode) {
        self.mode = mode;
    }

    pub fn set_session_meta(
        &mut self,
        replay_state: impl Into<String>,
        replay_speed: impl Into<String>,
        projection_versions: u64,
        websocket_clients: usize,
        resync_count: u64,
        uptime_ms: u64,
    ) {
        self.replay_state = replay_state.into();
        self.replay_speed = replay_speed.into();
        self.projection_versions = projection_versions;
        self.websocket_clients = websocket_clients;
        self.resync_count = resync_count;
        self.session_uptime_ms = uptime_ms;
    }

    pub fn last_correlation(&self) -> Option<&CorrelationProjection> {
        self.last_correlation.as_ref()
    }

    /// Snapshot the stateful operators for checkpointing (TA-039/040).
    pub fn snapshot_operators(&self) -> Vec<crate::operator::OperatorSnapshot> {
        vec![
            self.window.snapshot(),
            self.percentile.snapshot(),
            self.join.snapshot(),
        ]
    }

    /// Restore operator state from checkpoint snapshots, matched by
    /// operator id. Unknown ids are an error (spec 23: missing operator
    /// state is a recovery failure case).
    pub fn restore_operators(
        &mut self,
        snapshots: &[crate::operator::OperatorSnapshot],
    ) -> Result<(), String> {
        for snap in snapshots {
            let result = match snap.operator_id.as_str() {
                "heatmap_tumbling" => self.window.restore(snap.clone()),
                "latency_percentile" => self.percentile.restore(snap.clone()),
                "deploy_temporal_join" => self.join.restore(snap.clone()),
                other => return Err(format!("unknown operator in checkpoint: {other}")),
            };
            result.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.watermark.reset();
        self.batcher.reset();
        let _ = self.filter.on_control(&ControlMessage::Reset);
        let _ = self.window.on_control(&ControlMessage::Reset);
        let _ = self.percentile.on_control(&ControlMessage::Reset);
        let _ = self.join.on_control(&ControlMessage::Reset);
        let _ = self.sink.on_control(&ControlMessage::Reset);
        self.next_seq = 1;
        self.cursor_ns = 0;
        self.last_correlation = None;
        self.events_received = 0;
        self.duplicates = 0;
        self.invalid_events = 0;
        self.signal_counts = [0; 4];
        self.max_event_time_ns = i64::MIN;
    }

    pub fn rebuild_until(
        &mut self,
        envelopes: &[TelemetryEnvelope],
        cursor_ns: i64,
    ) -> Result<HeatmapProjection, String> {
        let filtered: Vec<_> = envelopes
            .iter()
            .filter(|e| e.event_time_ns <= cursor_ns)
            .cloned()
            .collect();
        self.rebuild_arrival_order(&filtered, cursor_ns)
    }

    pub fn rebuild_arrival_order(
        &mut self,
        arrival_order: &[TelemetryEnvelope],
        cursor_ns: i64,
    ) -> Result<HeatmapProjection, String> {
        self.reset();
        self.cursor_ns = cursor_ns;
        self.watermark.advance_processing_time(cursor_ns);
        self.batcher.set_processing_time(cursor_ns);

        let mut seen_ids = std::collections::BTreeSet::new();
        for (i, env) in arrival_order.iter().enumerate() {
            self.events_received += 1;
            if !seen_ids.insert(env.event_id.as_str().to_owned()) {
                self.duplicates += 1;
                continue;
            }
            self.max_event_time_ns = self.max_event_time_ns.max(env.event_time_ns);
            match SignalKind::from_envelope(env) {
                Some(SignalKind::Metrics) => self.signal_counts[0] += 1,
                Some(SignalKind::Spans) => self.signal_counts[1] += 1,
                Some(SignalKind::Logs) => self.signal_counts[2] += 1,
                Some(SignalKind::Changes) => self.signal_counts[3] += 1,
                None => {
                    self.invalid_events += 1;
                    continue;
                }
            }
            let seq = self.next_seq;
            self.next_seq += 1;
            let event = ingested(seq, partition_key_for(env), env.clone());
            let (_class, released) = self.watermark.push(event).map_err(|e| e.to_string())?;
            for r in released {
                self.ingest_released(r)?;
            }
            self.watermark
                .advance_processing_time((i as i64 + 1).saturating_mul(1_000_000));
        }
        for r in self.watermark.drain_all() {
            self.ingest_released(r)?;
        }
        for batch in self.batcher.flush_all().map_err(|e| e.to_string())? {
            self.run_batch(batch, cursor_ns)?;
        }
        let wm = cursor_ns.max(self.watermark.global_watermark_ns());
        let _ = self.window.on_watermark(wm);
        let _ = self.percentile.on_watermark(wm);
        let _ = self.join.on_watermark(wm);
        self.sink.apply_emits(self.window.last_emits(), cursor_ns);
        self.sink
            .apply_percentile_emits(self.percentile.last_emits(), cursor_ns);
        self.refresh_correlation(cursor_ns);
        Ok(self
            .sink
            .last_projection()
            .cloned()
            .unwrap_or(HeatmapProjection {
                projection_version: 1,
                cursor_event_time_ns: cursor_ns,
                bucket_width_ns: 1_000_000_000,
                cells: Vec::new(),
                streaming_note: None,
            }))
    }

    fn refresh_correlation(&mut self, cursor_ns: i64) {
        let join_in: Vec<JoinEvidenceInput> = self
            .join
            .last_emits()
            .iter()
            .map(|e| JoinEvidenceInput {
                telemetry_ref: e.telemetry_ref.clone(),
                service: e.service.clone(),
                change_id: e.change_id.clone(),
                change_type: e.change_type.clone(),
                deployed_version: e.deployed_version.clone(),
                change_time_ns: e.change_time_ns,
                unmatched: e.unmatched,
            })
            .collect();
        let p_in: Vec<PercentileWindowInput> = self
            .percentile
            .last_emits()
            .iter()
            .map(|e| PercentileWindowInput {
                service: e.service.clone(),
                percentile: e.percentile.clone(),
                estimated_value: e.estimated_value,
                window_start_ns: e.window_start_ns,
                window_end_ns: e.window_end_ns,
            })
            .collect();
        self.last_correlation = Some(build_correlation_from_emits(
            &join_in,
            &p_in,
            cursor_ns,
            self.sink.revisions().max(1),
        ));
    }

    /// Deterministic adversarial arrival schedule for M3 depth demos.
    pub fn adversarial_arrival_order(
        envelopes: &[TelemetryEnvelope],
        seed: u64,
    ) -> Vec<TelemetryEnvelope> {
        let mut metrics: Vec<_> = envelopes
            .iter()
            .filter(|e| e.signal == faultline_common::TelemetrySignal::Metric)
            .cloned()
            .collect();
        let mut changes: Vec<_> = envelopes
            .iter()
            .filter(|e| {
                matches!(
                    e.signal,
                    faultline_common::TelemetrySignal::Deployment
                        | faultline_common::TelemetrySignal::Configuration
                )
            })
            .cloned()
            .collect();
        let mut rest: Vec<_> = envelopes
            .iter()
            .filter(|e| {
                e.signal != faultline_common::TelemetrySignal::Metric
                    && e.signal != faultline_common::TelemetrySignal::Deployment
                    && e.signal != faultline_common::TelemetrySignal::Configuration
            })
            .cloned()
            .collect();

        if metrics.is_empty() {
            let mut all = envelopes.to_vec();
            let n = all.len().max(1);
            all.rotate_left((seed as usize) % n);
            return all;
        }

        let n = metrics.len();
        let rot = (seed as usize) % n;
        metrics.rotate_left(rot);

        // 1) keep early normal latency, 2) inject deployment early in arrival,
        // 3) delay a latency spike, 4) out-of-order, 5) duplicate, 6) late-revisable,
        // 7) beyond-grace candidate pushed last, 8) short burst at end.
        if n > 6 {
            let dup = metrics[1].clone();
            metrics.insert(3, dup);
            let late = metrics.remove(2);
            metrics.push(late);
            // Burst: clone a few high-latency looking rows near the end (same ids skipped later).
            if let Some(spike) = metrics
                .iter()
                .find(|e| matches!(&e.payload, TelemetryPayload::Metric(m) if m.value > 100.0))
            {
                let mut burst = spike.clone();
                // Distinct event id so it is not treated as duplicate; extreme late time for grace tests.
                burst.event_id = faultline_common::EventId::new(format!(
                    "{}-burst-{}",
                    spike.event_id.as_str(),
                    seed
                ));
                metrics.push(burst);
            }
        }
        // Place deployments after a few metrics so join sees both orders across seeds.
        let mut out = Vec::with_capacity(envelopes.len() + 4);
        let head = metrics.len().min(4);
        out.extend(metrics.drain(..head));
        out.append(&mut changes);
        out.append(&mut metrics);
        out.append(&mut rest);
        out
    }

    fn ingest_released(&mut self, event: faultline_ingest::IngestedEvent) -> Result<(), String> {
        let kind = SignalKind::from_envelope(&event.envelope);
        if kind != Some(SignalKind::Metrics) && kind != Some(SignalKind::Changes) {
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
        match batch.kind {
            SignalKind::Metrics => {
                let filtered = self.filter.on_batch(rt).map_err(|e| e.to_string())?;
                for b in filtered {
                    let _ = self.window.on_batch(b.clone()).map_err(|e| e.to_string())?;
                    let _ = self.percentile.on_batch(b).map_err(|e| e.to_string())?;
                    self.sink
                        .apply_emits(self.window.last_emits(), self.cursor_ns);
                    self.sink
                        .apply_percentile_emits(self.percentile.last_emits(), self.cursor_ns);
                    // Feed p99 window rows into temporal join as left side.
                    for e in self.percentile.last_emits() {
                        if e.percentile != "p99" {
                            continue;
                        }
                        let tele_ref =
                            format!("{}:{}:{}", e.service, e.window_start_ns, e.window_end_ns);
                        let _ = self.join.push_telemetry(
                            tele_ref,
                            e.service.clone(),
                            e.window_start_ns,
                            e.window_start_ns,
                            e.window_end_ns,
                            watermark_hint,
                        );
                    }
                }
            }
            SignalKind::Changes => {
                let _ = self.join.on_batch(rt).map_err(|e| e.to_string())?;
            }
            _ => {}
        }
        Ok(())
    }

    pub fn percentile_emits(&self) -> &[PercentileEmit] {
        self.percentile.last_emits()
    }

    pub fn inspector(&mut self) -> RuntimeInspectorDto {
        // Watermark derived metrics refresh lazily; bring them current for
        // this read (O(partitions), once per inspector snapshot).
        self.watermark.refresh_metrics();
        let wm = self.watermark.metrics();
        let filter_m = self.filter.metrics();
        let window_m = self.window.metrics();
        let perc_m = self.percentile.metrics();
        let join_m = self.join.metrics();
        let sink_m = self.sink.metrics();

        let latest_p = |label: &str| {
            self.percentile
                .last_emits()
                .iter()
                .rev()
                .find(|e| e.percentile == label)
                .map(|e| e.estimated_value)
        };

        let nodes = vec![
            OperatorNode {
                stable_id: "metric_source".into(),
                operator_type: "MetricSource".into(),
                query_id: "ingest".into(),
                upstream_ids: vec![],
                downstream_ids: vec!["filter_lat_err_mem".into()],
                rows_in: self.events_received,
                rows_out: self.signal_counts[0],
                batches_in: 0,
                batches_out: self.batcher.metrics.stats().flushes,
                processing_time_ns: 0,
                queue_wait_ns: 0,
                queue_depth: wm.reorder_buffer_size,
                queue_capacity: 50_000,
                state_bytes: wm.reorder_buffer_size * 64,
                active_windows: 0,
                finalized_windows: 0,
                watermark_ns: wm.global_watermark_ns,
                late_revisions: wm.late_events,
                errors: self.invalid_events,
                last_activity_ns: self.cursor_ns,
                percentile: None,
                temporal_join: None,
            },
            op_node_from(
                &filter_m,
                "Filter",
                "heatmap_svc_time",
                &["metric_source"],
                &["heatmap_tumbling", "latency_percentile"],
                0,
                0,
                None,
                None,
            ),
            op_node_from(
                &window_m,
                "Window",
                "heatmap_svc_time",
                &["filter_lat_err_mem"],
                &["heatmap_sink"],
                self.window.active_window_count(),
                self.window.finalized_window_count(),
                None,
                None,
            ),
            op_node_from(
                &perc_m,
                "P99",
                "heatmap_p99",
                &["filter_lat_err_mem"],
                &["heatmap_sink", "deploy_temporal_join"],
                self.percentile.active_window_count(),
                self.percentile.finalized_window_count(),
                Some(PercentileOperatorStats {
                    observations: perc_m.rows_in,
                    sketch_state_bytes: perc_m.state_bytes,
                    estimated_p50: latest_p("p50"),
                    estimated_p95: latest_p("p95"),
                    estimated_p99: latest_p("p99"),
                    approximation: "ddsketch".into(),
                    alpha: self.percentile.alpha(),
                    validation_relative_error: self.percentile.last_validation_error(),
                }),
                None,
            ),
            op_node_from(
                &join_m,
                "TemporalJoin",
                "deploy_correlation",
                &["latency_percentile", "change_source"],
                &["correlation_sink"],
                0,
                0,
                None,
                Some(TemporalJoinOperatorStats {
                    left_state_rows: self.join.left_state_rows(),
                    right_state_rows: self.join.right_state_rows(),
                    matches: self.join.match_count(),
                    unmatched_rows: self.join.unmatched_count(),
                    expired_rows: self.join.expired_count(),
                    lookback_ns: self.join.lookback_ns(),
                    lookahead_ns: self.join.lookahead_ns(),
                    state_bytes: join_m.state_bytes,
                }),
            ),
            op_node_from(
                &sink_m,
                "HeatmapSink",
                "heatmap_svc_time",
                &["heatmap_tumbling", "latency_percentile"],
                &[],
                0,
                0,
                None,
                None,
            ),
        ];

        let max_util = nodes
            .iter()
            .map(|n| {
                if n.queue_capacity == 0 {
                    0.0
                } else {
                    n.queue_depth as f64 / n.queue_capacity as f64
                }
            })
            .fold(0.0, f64::max);
        let limiting = nodes
            .iter()
            .max_by(|a, b| {
                let ua = if a.queue_capacity == 0 {
                    0.0
                } else {
                    a.queue_depth as f64 / a.queue_capacity as f64
                };
                let ub = if b.queue_capacity == 0 {
                    0.0
                } else {
                    b.queue_depth as f64 / b.queue_capacity as f64
                };
                ua.partial_cmp(&ub).unwrap()
            })
            .map(|n| n.stable_id.clone());

        let lag = if self.max_event_time_ns == i64::MIN {
            0
        } else {
            self.max_event_time_ns
                .saturating_sub(wm.global_watermark_ns)
                .max(0)
        };

        RuntimeInspectorDto {
            runtime_projection_version: RUNTIME_PROJECTION_VERSION,
            ingestion: IngestionStats {
                events_received: self.events_received,
                duplicates: self.duplicates,
                invalid_events: self.invalid_events,
                events_by_signal: vec![
                    SignalCount {
                        signal: "metrics".into(),
                        count: self.signal_counts[0],
                    },
                    SignalCount {
                        signal: "spans".into(),
                        count: self.signal_counts[1],
                    },
                    SignalCount {
                        signal: "logs".into(),
                        count: self.signal_counts[2],
                    },
                    SignalCount {
                        signal: "changes".into(),
                        count: self.signal_counts[3],
                    },
                ],
                reorder_buffer_occupancy: wm.reorder_buffer_size,
            },
            event_time: EventTimeStats {
                max_event_time_ns: self.max_event_time_ns,
                global_watermark_ns: wm.global_watermark_ns,
                partition_watermarks: wm
                    .partition_watermarks
                    .iter()
                    .map(|(k, v)| PartitionWatermark {
                        partition: k.clone(),
                        watermark_ns: *v,
                    })
                    .collect(),
                watermark_lag_ns: lag,
                allowed_lateness_ns: self.watermark.config().allowed_lateness_ns,
                late_but_revisable_events: wm.late_events,
                beyond_grace_events: wm.beyond_grace_events,
                idle_partitions: wm.idle_partitions,
            },
            batching: BatchingStats {
                batches_created: self.batcher.metrics.stats().flushes
                    + self.batcher.spans.stats().flushes
                    + self.batcher.logs.stats().flushes
                    + self.batcher.changes.stats().flushes,
                rows_per_batch_avg: 64.0,
                bytes_per_batch_avg: 0.0,
                batch_flush_reasons: vec!["max_rows".into(), "flush_all".into()],
                max_batch_age_ns: i64::MAX / 4,
            },
            operators: nodes,
            session: SessionRuntimeStats {
                projection_mode: format!("{:?}", self.mode).to_ascii_lowercase(),
                replay_state: self.replay_state.clone(),
                replay_speed: self.replay_speed.clone(),
                cursor_event_time_ns: self.cursor_ns,
                session_uptime_ms: self.session_uptime_ms,
                projection_versions: self.projection_versions,
                heatmap_revisions: self.sink.revisions(),
                websocket_clients: self.websocket_clients,
                resync_count: self.resync_count,
            },
            backpressure: BackpressureStats {
                limiting_operator_id: limiting,
                max_queue_utilization: max_util,
                any_queue_saturated: max_util >= 0.9,
            },
            architecture_status: default_architecture_status(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn op_node_from(
    m: &crate::operator::OperatorMetrics,
    op_type: &str,
    query_id: &str,
    up: &[&str],
    down: &[&str],
    active: usize,
    finalized: usize,
    percentile: Option<PercentileOperatorStats>,
    temporal_join: Option<TemporalJoinOperatorStats>,
) -> OperatorNode {
    OperatorNode {
        stable_id: m.operator_id.clone(),
        operator_type: op_type.into(),
        query_id: query_id.into(),
        upstream_ids: up.iter().map(|s| (*s).to_owned()).collect(),
        downstream_ids: down.iter().map(|s| (*s).to_owned()).collect(),
        rows_in: m.rows_in,
        rows_out: m.rows_out,
        batches_in: m.batches_in,
        batches_out: m.batches_out,
        processing_time_ns: m.processing_duration_ns,
        queue_wait_ns: m.queue_wait_duration_ns,
        queue_depth: m.queue_depth,
        queue_capacity: m.channel_capacity.max(64),
        state_bytes: m.state_bytes,
        active_windows: active,
        finalized_windows: finalized,
        watermark_ns: m.current_watermark_ns,
        late_revisions: m.late_events,
        errors: m.errors,
        last_activity_ns: m.last_activity_ns,
        percentile,
        temporal_join,
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
        assert!(heat
            .cells
            .iter()
            .any(|c| c.p99.is_some() || c.value_source.as_deref() == Some("streaming_p99")));
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

    #[test]
    fn adversarial_schedule_is_seed_stable() {
        let envs = vec![
            metric("a", 1, "frontend", "frontend_lat", 1.0),
            metric("b", 2, "frontend", "frontend_lat", 2.0),
            metric("c", 3, "frontend", "frontend_lat", 3.0),
            metric("d", 4, "frontend", "frontend_lat", 4.0),
            metric("e", 5, "frontend", "frontend_lat", 5.0),
        ];
        let a = HeatmapStreamingPipeline::adversarial_arrival_order(&envs, 7);
        let b = HeatmapStreamingPipeline::adversarial_arrival_order(&envs, 7);
        assert_eq!(
            a.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>(),
            b.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>()
        );
    }
}
