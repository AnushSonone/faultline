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
};

export type HeatmapPayload = {
  projection_version: number;
  cursor_event_time_ns: number;
  bucket_width_ns: number;
  cells: HeatmapCell[];
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
