export type WsEnvelope = {
  protocol_version: number;
  session_id: string;
  sequence: number;
  server_time_ns: number;
  event_time_ns: number;
  type: string;
  payload: unknown;
};

// Wire shape from crates/graph/src/service_graph.rs: every node and edge
// carries request, error and total-duration counters.
export type TopologyNode = {
  service: string;
  request_count?: number;
  error_count?: number;
  total_duration_ns?: number;
  [k: string]: unknown;
};

export type TopologyEdge = {
  from: string;
  to: string;
  request_count?: number;
  error_count?: number;
  total_duration_ns?: number;
  [k: string]: unknown;
};

export type TopologyPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  graph: {
    nodes: TopologyNode[];
    edges: TopologyEdge[];
  };
};

export type TimelineEvent = {
  event_id: string;
  event_time_ns: number;
  signal: string;
  service?: string | null;
  summary: string;
};

export type TimelinePayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  events: TimelineEvent[];
};

export type HeatmapCell = {
  service: string;
  bucket_start_ns: number;
  value: number;
  sample_count: number;
  p50?: number | null;
  p95?: number | null;
  p99?: number | null;
  metric_kind?: string | null;
  operator_id?: string | null;
  window_id?: string | null;
  value_source?: string | null;
};

export type HeatmapPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  bucket_width_ns: number;
  cells: HeatmapCell[];
  streaming_note?: string | null;
};

export type DeploymentCorrelation = {
  change_id: string;
  service: string;
  change_type: string;
  deployed_version?: string | null;
  deployed_at_ns: number;
  first_anomaly_ns?: number | null;
  delay_ns?: number | null;
  associated_anomalous_windows: number;
  p99_before?: number | null;
  p99_after?: number | null;
  match_confidence: string;
  evidence_refs: string[];
  language: string;
};

export type CorrelationPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  correlations: DeploymentCorrelation[];
};

export type ScoreComponent = {
  name: string;
  feature_value: number;
  weight: number;
  contribution: number;
};

export type RootCauseCandidate = {
  rank: number;
  service: string;
  score: number;
  components: ScoreComponent[];
  features: {
    onset_ns?: number | null;
    peak_abs_z: number;
    impacted_anomalous: string[];
    preceding_impacted: string[];
    // Envelope event ids (join to TimelineEvent.event_id) and trace ids.
    anomaly_refs?: string[];
    change_refs?: string[];
    log_refs?: string[];
    failed_trace_ids?: string[];
    [k: string]: unknown;
  };
};

export type RootCauseEvidence = {
  evidence_id: string;
  incident_id: string;
  candidate_service: string;
  type: string;
  event_time_range: [number, number];
  strength: number;
  direction: "supports" | "contradicts";
  source_refs: string[];
  human_label: string;
  details: Record<string, unknown>;
};

export type RootCausePayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  incident_onset_ns?: number | null;
  language: string;
  candidates: RootCauseCandidate[];
  evidence: RootCauseEvidence[];
};

export type EvidenceGraphNode = {
  id: string;
  kind: string;
  label: string;
  service?: string | null;
  time_ns?: number | null;
  strength: number;
  source_refs: string[];
};

export type EvidenceGraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  label: string;
};

export type EvidenceGraphPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  graph: {
    incident_id: string;
    nodes: EvidenceGraphNode[];
    edges: EvidenceGraphEdge[];
  };
};

export type SpanDelta = {
  service?: string | null;
  operation: string;
  path_key: string;
  failed_span_id?: string | null;
  healthy_span_id?: string | null;
  failed_duration_ns?: number | null;
  healthy_duration_ns?: number | null;
  delta_ns?: number | null;
};

export type TraceComparison = {
  failed_trace_id: string;
  healthy_trace_id: string;
  comparable_confidence: number;
  total_excess_ns: number;
  failed_critical_ns: number;
  healthy_critical_ns: number;
  critical_path_delta_ns: number;
  aligned: SpanDelta[];
  added_services: string[];
  removed_services: string[];
};

// One span of a trace DAG (crates/graph/src/trace_graph.rs TraceSpanNode).
export type TraceSpan = {
  span_id: string;
  parent_span_id?: string | null;
  service?: string | null;
  operation: string;
  start_time_ns: number;
  end_time_ns: number;
  duration_ns: number;
  status: string;
  peer_service?: string | null;
  missing_parent: boolean;
};

export type TraceDetail = {
  dag: { trace_id: string; spans: TraceSpan[]; incomplete: boolean };
  critical_path?: {
    span_ids: string[];
    critical_duration_ns: number;
    total_duration_ns: number;
    service_contribution_ns: Record<string, number>;
  } | null;
  cohort?: {
    cohort_trace_ids: string[];
    median_trace_id?: string | null;
    confidence: number;
  } | null;
  comparison?: TraceComparison | null;
};

export type TraceSummary = {
  trace_id: string;
  span_count: number;
  incomplete: boolean;
};

export type TraceListPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  traces: TraceSummary[];
};

// ---------- runtime inspector (ADR 0019, runtime_projection_version 1) ----------

export type SignalCount = { signal: string; count: number };

export type IngestionStats = {
  events_received: number;
  duplicates: number;
  invalid_events: number;
  events_by_signal: SignalCount[];
  reorder_buffer_occupancy: number;
};

export type PartitionWatermark = { partition: string; watermark_ns: number };

export type EventTimeStats = {
  max_event_time_ns: number;
  global_watermark_ns: number;
  partition_watermarks: PartitionWatermark[];
  watermark_lag_ns: number;
  allowed_lateness_ns: number;
  late_but_revisable_events: number;
  beyond_grace_events: number;
  idle_partitions: number;
};

export type BatchingStats = {
  batches_created: number;
  rows_per_batch_avg: number;
  bytes_per_batch_avg: number;
  batch_flush_reasons: string[];
  max_batch_age_ns: number;
};

export type PercentileOperatorStats = {
  observations: number;
  sketch_state_bytes: number;
  estimated_p50?: number | null;
  estimated_p95?: number | null;
  estimated_p99?: number | null;
  approximation: string;
  alpha: number;
  validation_relative_error?: number | null;
};

export type TemporalJoinOperatorStats = {
  left_state_rows: number;
  right_state_rows: number;
  matches: number;
  unmatched_rows: number;
  expired_rows: number;
  lookback_ns: number;
  lookahead_ns: number;
  state_bytes: number;
};

export type OperatorNode = {
  stable_id: string;
  operator_type: string;
  query_id: string;
  upstream_ids: string[];
  downstream_ids: string[];
  rows_in: number;
  rows_out: number;
  batches_in: number;
  batches_out: number;
  processing_time_ns: number;
  queue_wait_ns: number;
  queue_depth: number;
  queue_capacity: number;
  state_bytes: number;
  active_windows: number;
  finalized_windows: number;
  watermark_ns: number;
  late_revisions: number;
  errors: number;
  last_activity_ns: number;
  percentile?: PercentileOperatorStats | null;
  temporal_join?: TemporalJoinOperatorStats | null;
};

export type SessionRuntimeStats = {
  projection_mode: string;
  replay_state: string;
  replay_speed: string;
  cursor_event_time_ns: number;
  session_uptime_ms: number;
  projection_versions: number;
  heatmap_revisions: number;
  websocket_clients: number;
  resync_count: number;
};

export type BackpressureStats = {
  limiting_operator_id?: string | null;
  max_queue_utilization: number;
  any_queue_saturated: boolean;
};

export type RuntimeInspectorDto = {
  runtime_projection_version: number;
  ingestion: IngestionStats;
  event_time: EventTimeStats;
  batching: BatchingStats;
  operators: OperatorNode[];
  session: SessionRuntimeStats;
  backpressure: BackpressureStats;
  architecture_status: string[];
};

// ---------- query planner (TA-046/047) ----------

export type PhysicalOperator = { operator_id: string; kind: string; detail: string };

export type PhysicalPlan = {
  operators: PhysicalOperator[];
  partitioning: string;
  state_retention: string;
  watermark_policy: string;
};

export type ExecMetrics = {
  rows_scanned: number;
  rows_after_filter: number;
  rows_out: number;
  wall_time_us: number;
};

export type ExplainOutput = {
  statement: string;
  logical_plan: string;
  optimized_logical_plan: string;
  physical_plan: PhysicalPlan;
  operator_ids: string[];
  partitioning: string;
  state_retention: string;
  watermark_policy: string;
  analyze?: ExecMetrics | null;
};

export type QueryResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  metrics: ExecMetrics;
};

// ---------- checkpoints (ADR 0021) ----------

export type CheckpointMetrics = {
  checkpoint_id: string;
  checkpoint_duration_seconds: number;
  checkpoint_bytes: number;
  path: string;
};

export type RecoveryReport = {
  recovered_checkpoint_id: string;
  fell_back: boolean;
  recovery_duration_seconds: number;
  cursor_ns: number;
  duplicates_after_recovery: boolean;
  evidence_id_count: number;
  rejected: string[] | number | null;
};
