import { create } from "zustand";
import type {
  HeatmapPayload,
  TimelinePayload,
  TopologyPayload,
  TraceListPayload,
  WsEnvelope,
} from "../types/protocol";

export type ReplayStatus = {
  state: string;
  speed?: string;
  event_time_ns?: number;
};

type InvestigationState = {
  sessionId: string | null;
  incidentId: string | null;
  connected: boolean;
  lastError: string | null;
  lastSequence: number;
  replay: ReplayStatus;
  topology: TopologyPayload | null;
  timeline: TimelinePayload | null;
  heatmap: HeatmapPayload | null;
  traces: TraceListPayload | null;
  selectedEventTime: number | null;
  selectedService: string | null;
  selectedTrace: string | null;
  setSession: (id: string) => void;
  setIncident: (id: string | null) => void;
  setConnected: (v: boolean) => void;
  setError: (e: string | null) => void;
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
  replay: { state: "stopped" },
  topology: null,
  timeline: null,
  heatmap: null,
  traces: null,
  selectedEventTime: null,
  selectedService: null,
  selectedTrace: null,
  setSession: (id) => set({ sessionId: id }),
  setIncident: (id) => set({ incidentId: id }),
  setConnected: (v) => set({ connected: v }),
  setError: (e) => set({ lastError: e }),
  selectService: (s) => set({ selectedService: s }),
  selectTrace: (t) => set({ selectedTrace: t }),
  selectTime: (t) => set({ selectedEventTime: t }),
  applyWs: (msg) => {
    const prev = get().lastSequence;
    if (prev && msg.sequence > prev + 1) {
      set({ lastError: `WS sequence gap ${prev} -> ${msg.sequence}; request resync` });
    }
    const patch: Partial<InvestigationState> = {
      lastSequence: msg.sequence,
      selectedEventTime: msg.event_time_ns,
    };
    switch (msg.type) {
      case "replay.status":
        patch.replay = msg.payload as ReplayStatus;
        break;
      case "clock.tick":
        patch.selectedEventTime = (msg.payload as { event_time_ns: number }).event_time_ns;
        break;
      case "topology.snapshot":
        patch.topology = msg.payload as TopologyPayload;
        break;
      case "timeline.append":
        patch.timeline = msg.payload as TimelinePayload;
        break;
      case "heatmap.delta":
        patch.heatmap = msg.payload as HeatmapPayload;
        break;
      case "trace.available":
        patch.traces = msg.payload as TraceListPayload;
        break;
      case "session.ready":
        patch.incidentId = (msg.payload as { incident_id?: string }).incident_id ?? get().incidentId;
        break;
      default:
        break;
    }
    set(patch);
  },
}));
