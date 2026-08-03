//! Versioned runtime inspector projection (TA-028). Separate from user telemetry projections.

use serde::{Deserialize, Serialize};

pub const RUNTIME_PROJECTION_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct IngestionStats {
    pub events_received: u64,
    pub duplicates: u64,
    pub invalid_events: u64,
    pub events_by_signal: Vec<SignalCount>,
    pub reorder_buffer_occupancy: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SignalCount {
    pub signal: String,
    pub count: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EventTimeStats {
    pub max_event_time_ns: i64,
    pub global_watermark_ns: i64,
    pub partition_watermarks: Vec<PartitionWatermark>,
    pub watermark_lag_ns: i64,
    pub allowed_lateness_ns: i64,
    pub late_but_revisable_events: u64,
    pub beyond_grace_events: u64,
    pub idle_partitions: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PartitionWatermark {
    pub partition: String,
    pub watermark_ns: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BatchingStats {
    pub batches_created: u64,
    pub rows_per_batch_avg: f64,
    pub bytes_per_batch_avg: f64,
    pub batch_flush_reasons: Vec<String>,
    pub max_batch_age_ns: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OperatorNode {
    pub stable_id: String,
    pub operator_type: String,
    pub query_id: String,
    pub upstream_ids: Vec<String>,
    pub downstream_ids: Vec<String>,
    pub rows_in: u64,
    pub rows_out: u64,
    pub batches_in: u64,
    pub batches_out: u64,
    pub processing_time_ns: u64,
    pub queue_wait_ns: u64,
    pub queue_depth: usize,
    pub queue_capacity: usize,
    pub state_bytes: usize,
    pub active_windows: usize,
    pub finalized_windows: usize,
    pub watermark_ns: i64,
    pub late_revisions: u64,
    pub errors: u64,
    pub last_activity_ns: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percentile: Option<PercentileOperatorStats>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temporal_join: Option<TemporalJoinOperatorStats>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PercentileOperatorStats {
    pub observations: u64,
    pub sketch_state_bytes: usize,
    pub estimated_p50: Option<f64>,
    pub estimated_p95: Option<f64>,
    pub estimated_p99: Option<f64>,
    pub approximation: String,
    pub alpha: f64,
    pub validation_relative_error: Option<f64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TemporalJoinOperatorStats {
    pub left_state_rows: usize,
    pub right_state_rows: usize,
    pub matches: u64,
    pub unmatched_rows: u64,
    pub expired_rows: u64,
    pub lookback_ns: i64,
    pub lookahead_ns: i64,
    pub state_bytes: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SessionRuntimeStats {
    pub projection_mode: String,
    pub replay_state: String,
    pub replay_speed: String,
    pub cursor_event_time_ns: i64,
    pub session_uptime_ms: u64,
    pub projection_versions: u64,
    pub heatmap_revisions: u64,
    pub websocket_clients: usize,
    pub resync_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeInspectorDto {
    pub runtime_projection_version: u32,
    pub ingestion: IngestionStats,
    pub event_time: EventTimeStats,
    pub batching: BatchingStats,
    pub operators: Vec<OperatorNode>,
    pub session: SessionRuntimeStats,
    pub backpressure: BackpressureStats,
    /// Compact architecture honesty (product boundary).
    pub architecture_status: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BackpressureStats {
    pub limiting_operator_id: Option<String>,
    pub max_queue_utilization: f64,
    pub any_queue_saturated: bool,
}

impl Default for RuntimeInspectorDto {
    fn default() -> Self {
        Self {
            runtime_projection_version: RUNTIME_PROJECTION_VERSION,
            ingestion: IngestionStats::default(),
            event_time: EventTimeStats::default(),
            batching: BatchingStats::default(),
            operators: Vec::new(),
            session: SessionRuntimeStats::default(),
            backpressure: BackpressureStats::default(),
            architecture_status: default_architecture_status(),
        }
    }
}

pub fn default_architecture_status() -> Vec<String> {
    vec![
        "Heatmap values: streaming".into(),
        "Heatmap p95/p99: streaming percentile".into(),
        "Deployment correlation: streaming temporal join".into(),
        "Topology structure: precomputed".into(),
        "Timeline base events: precomputed".into(),
        "Trace waterfall: precomputed".into(),
        "Root-cause inference: deterministic evidence ranking (M4)".into(),
        "Trace comparison: vs median healthy baseline (M5)".into(),
        "Checkpoint recovery: idempotent projections, not exactly-once (M6)".into(),
        "Query planner: EXPLAIN ANALYZE over session events (M7)".into(),
        "Ground truth: hidden unless evaluation mode".into(),
    ]
}
