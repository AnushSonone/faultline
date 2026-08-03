export type WsEnvelope = {
  protocol_version: number;
  session_id: string;
  sequence: number;
  server_time_ns: number;
  event_time_ns: number;
  type: string;
  payload: unknown;
};

export type TopologyPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  graph: {
    nodes: Array<{ service: string; request_count?: number; error_count?: number; [k: string]: unknown }>;
    edges: Array<{ from: string; to: string; [k: string]: unknown }>;
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

export type TraceDetail = {
  dag: { trace_id: string; spans: unknown[]; incomplete: boolean };
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
