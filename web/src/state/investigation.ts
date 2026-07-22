import { create } from "zustand";
import type {
  HeatmapPayload,
  TimelinePayload,
  TopologyPayload,
  TraceListPayload,
  WsEnvelope,
} from "../types/protocol";
export type GroundTruth = {
  source: string;
  not_inferred: boolean;
  fault_type: string;
  root_cause_services: string[];
  root_cause_indicators: string[];
  fault_start_time_ns: number;
  fault_end_time_ns: number;
  notes?: string;
};

export type ReplayStatus = {
  state: string;
  speed?: string;
  event_time_ns?: number;
  heatmap_mode?: string;
};

export type RuntimeInspector = {
  global_watermark_ns: number;
  allowed_lateness_ns: number;
  late_events: number;
  beyond_grace_events?: number;
  reorder_buffer_size: number;
  operators: Array<{ operator_id: string; rows_in?: number; batches_in?: number; queue_depth?: number }>;
  rows_processed?: number;
  batches_processed?: number;
  queue_depth?: number;
  active_window_count: number;
  finalized_window_count: number;
  heatmap_revisions: number;
  projection_mode: string;
};

type InvestigationState = {
  sessionId: string | null;
  incidentId: string | null;
  connected: boolean;
  lastError: string | null;
  lastSequence: number;
  needsResync: boolean;
  replay: ReplayStatus;
  topology: TopologyPayload | null;
  timeline: TimelinePayload | null;
  heatmap: HeatmapPayload | null;
  traces: TraceListPayload | null;
  groundTruth: GroundTruth | null;
  runtimeInspector: RuntimeInspector | null;
  heatmapMode: string;
  selectedEventTime: number | null;
  selectedService: string | null;
  selectedTrace: string | null;
  setSession: (id: string) => void;
  setIncident: (id: string | null) => void;
  setConnected: (v: boolean) => void;
  setError: (e: string | null) => void;
  setGroundTruth: (g: GroundTruth | null) => void;
  clearNeedsResync: () => void;
  clearSelection: () => void;
  selectService: (s: string | null) => void;
  selectTrace: (t: string | null) => void;
  selectTime: (t: number | null) => void;
  applyWs: (msg: WsEnvelope) => void;
};

export const useInvestigation = create<InvestigationState>((set, get) => ({
  sessionId: null,
  incidentId: null,
  connected: false,
  lastError: null,
  lastSequence: 0,
  needsResync: false,
  replay: { state: "stopped" },
  topology: null,
  timeline: null,
  heatmap: null,
  traces: null,
  groundTruth: null,
  runtimeInspector: null,
  heatmapMode: "streaming",
  selectedEventTime: null,
  selectedService: null,
  selectedTrace: null,
  setSession: (id) => set({ sessionId: id }),
  setIncident: (id) => set({ incidentId: id }),
  setConnected: (v) => set({ connected: v }),
  setError: (e) => set({ lastError: e }),
  setGroundTruth: (g) => set({ groundTruth: g }),
  clearNeedsResync: () => set({ needsResync: false, lastError: null }),
  clearSelection: () =>
    set({
      selectedService: null,
      selectedTrace: null,
      selectedEventTime: null,
      topology: null,
      timeline: null,
      heatmap: null,
      traces: null,
      lastSequence: 0,
      needsResync: false,
    }),
  selectService: (s) => set({ selectedService: s }),
  selectTrace: (t) => set({ selectedTrace: t }),
  selectTime: (t) => set({ selectedEventTime: t }),
  applyWs: (msg) => {
    const prev = get().lastSequence;
    if (prev && msg.sequence > prev + 1) {
      set({
        needsResync: true,
        lastError: `WS sequence gap ${prev} -> ${msg.sequence}; requesting resync`,
      });
    }
    const patch: Partial<InvestigationState> = {
      lastSequence: msg.sequence,
      selectedEventTime: msg.event_time_ns,
    };
    switch (msg.type) {
      case "replay.status": {
        const st = msg.payload as ReplayStatus;
        patch.replay = st;
        if (st.heatmap_mode) patch.heatmapMode = st.heatmap_mode;
        break;
      }
      case "clock.tick":
        patch.selectedEventTime = (msg.payload as { event_time_ns: number }).event_time_ns;
        break;
      case "topology.snapshot":
        patch.topology = msg.payload as TopologyPayload;
        break;
      case "timeline.append":
        // M2 emits full timeline payloads under this type name.
        patch.timeline = msg.payload as TimelinePayload;
        break;
      case "heatmap.delta":
        // Full heatmap payloads (precomputed or streaming); replace by version.
        patch.heatmap = msg.payload as HeatmapPayload;
        break;
      case "runtime.inspector":
        patch.runtimeInspector = msg.payload as RuntimeInspector;
        if ((msg.payload as RuntimeInspector).projection_mode) {
          patch.heatmapMode = (msg.payload as RuntimeInspector).projection_mode;
        }
        break;
      case "trace.available":
        patch.traces = msg.payload as TraceListPayload;
        break;
      case "session.ready": {
        const ready = msg.payload as {
          incident_id?: string;
          ground_truth?: GroundTruth;
        };
        patch.incidentId = ready.incident_id ?? get().incidentId;
        if (ready.ground_truth) {
          patch.groundTruth = ready.ground_truth;
        }
        break;
      }
      default:
        break;
    }
    set(patch);
  },
}));
