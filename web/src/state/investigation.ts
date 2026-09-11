import { create } from "zustand";
import { anomalyOnsetNs } from "../lib/progress";
import type { CaseInfo } from "../api/client";
import type {
  CorrelationPayload,
  EvidenceGraphPayload,
  HeatmapCell,
  HeatmapPayload,
  RootCausePayload,
  TimelinePayload,
  TopologyPayload,
  TraceListPayload,
  WsEnvelope,
  CheckpointMetrics,
  ExecMetrics,
  ExplainOutput,
  RecoveryReport,
  RuntimeInspectorDto,
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

// The wire DTO (ADR 0019), every field optional on the client so a partial
// or older payload never throws at render time.
export type RuntimeInspector = Partial<RuntimeInspectorDto> & {
  operators?: RuntimeInspectorDto["operators"];
};

export type EngineWarning = { message: string; sequence: number; server_time_ns: number };

// "overview" is the stage itself; every other tab opens the dock drawer.
export type TabId = "overview" | "root-causes" | "signals" | "case" | "runtime";

// Sub-tabs inside the Runtime drawer: one visual at a time.
export type RuntimeTabId = "pipeline" | "event-time" | "queries" | "scoring" | "recovery";

export type WsStatus = "connecting" | "live" | "reconnecting";

// Which region the walkthrough is pointing at. Regions carry a matching
// `data-walk` attribute for the spotlight; the four stage panels also add
// an outline class for it.
export type TourTarget =
  | "map"
  | "track"
  | "evidence"
  | "verdict"
  | "transport"
  | "incident"
  | "ranking"
  | "feed"
  | "dock"
  | "tab-root-causes"
  | "tab-signals"
  | "tab-case"
  | "tab-runtime";

type InvestigationState = {
  sessionId: string | null;
  incidentId: string | null;
  activeTab: TabId;
  incidentStartNs: number | null;
  incidentEndNs: number | null;
  connected: boolean;
  wsStatus: WsStatus;
  wsRetries: number;
  lastError: string | null;
  lastSequence: number;
  needsResync: boolean;
  replay: ReplayStatus;
  topology: TopologyPayload | null;
  timeline: TimelinePayload | null;
  heatmap: HeatmapPayload | null;
  traces: TraceListPayload | null;
  correlations: CorrelationPayload["correlations"];
  rootCauses: RootCausePayload | null;
  evidenceGraph: EvidenceGraphPayload | null;
  lastCheckpoint: CheckpointMetrics | null;
  recoveryReport: RecoveryReport | null;
  recoveryState: "idle" | "recovering" | "recovered";
  // Set by checkpoint.started, cleared by checkpoint.completed.
  checkpointInFlight: string | null;
  // Last EXPLAIN ANALYZE seen on the stream (query.plan / query.metrics).
  lastQueryPlan: ExplainOutput | null;
  lastQueryMetrics: ExecMetrics | null;
  // engine.warning messages, newest last, capped.
  engineWarnings: EngineWarning[];
  groundTruth: GroundTruth | null;
  // The incident record from GET /sessions/{id}/case. Fetched once when the
  // session loads so the rail dossier and the Case file share one request;
  // replaced by the revealed payload when the visitor unlocks ground truth.
  caseInfo: CaseInfo | null;
  runtimeInspector: RuntimeInspector | null;
  heatmapMode: string;
  selectedEventTime: number | null;
  selectedService: string | null;
  hoveredService: string | null;
  selectedTrace: string | null;
  selectedOperator: string | null;
  selectedChangeId: string | null;
  selectedHeatmapCell: HeatmapCell | null;
  tourTarget: TourTarget | null;
  // True once a replay has been played through to the incident end in this
  // session. Derived from a playing -> stopped@end transition, never from the
  // cursor alone: a seek to the end is not a replay.
  replayCompleted: boolean;
  // Investigation progress, latched (seeking backwards never un-ticks a row)
  // and reset with the session. Not latched while the walkthrough runs: its
  // seek to the end is not the visitor's doing.
  briefOpen: boolean;
  briefRead: boolean;
  visitedTabs: TabId[];
  playedOnce: boolean;
  anomalyOnsetNs: number | null;
  sawAnomaly: boolean;
  sawRanking: boolean;
  // True after the walkthrough closes until the replay reports the reset
  // that follows it, so the tail of the tour's end state never ticks a row.
  progressMuted: boolean;
  // First-visit choice card over the stage.
  firstVisit: boolean;
  // Walkthrough step index, null when not running.
  walkStep: number | null;
  // Active Runtime sub-tab; a view preference, so clearSelection leaves it.
  runtimeTab: RuntimeTabId;
  // SQL handed from the Case file's raw records to the query workbench.
  querySeed: string | null;
  // Set once the visitor has revealed the fault-injection label this session.
  groundTruthRevealed: boolean;
  setSession: (id: string) => void;
  setIncident: (id: string | null) => void;
  setTab: (tab: TabId) => void;
  setIncidentRange: (start: number | null, end: number | null) => void;
  setConnected: (v: boolean) => void;
  wsOpened: () => void;
  wsClosed: () => void;
  setError: (e: string | null) => void;
  setGroundTruth: (g: GroundTruth | null) => void;
  setCaseInfo: (c: CaseInfo | null) => void;
  clearNeedsResync: () => void;
  clearSelection: () => void;
  selectService: (s: string | null) => void;
  hoverService: (s: string | null) => void;
  selectTrace: (t: string | null) => void;
  selectTime: (t: number | null) => void;
  selectOperator: (id: string | null) => void;
  selectChange: (id: string | null) => void;
  selectHeatmapCell: (c: HeatmapCell | null) => void;
  setTourTarget: (t: TourTarget | null) => void;
  setWalkStep: (n: number | null) => void;
  setRuntimeTab: (t: RuntimeTabId) => void;
  seedQuery: (sql: string | null) => void;
  markGroundTruthRevealed: () => void;
  setBriefOpen: (open: boolean, opts?: { read?: boolean }) => void;
  setFirstVisit: (v: boolean) => void;
  muteProgress: () => void;
  applyWs: (msg: WsEnvelope) => void;
};

export const useInvestigation = create<InvestigationState>((set, get) => ({
  sessionId: null,
  incidentId: null,
  activeTab: "overview",
  incidentStartNs: null,
  incidentEndNs: null,
  connected: false,
  wsStatus: "connecting" as WsStatus,
  wsRetries: 0,
  lastError: null,
  lastSequence: 0,
  needsResync: false,
  replay: { state: "stopped" },
  topology: null,
  timeline: null,
  heatmap: null,
  traces: null,
  correlations: [],
  rootCauses: null,
  evidenceGraph: null,
  lastCheckpoint: null,
  recoveryReport: null,
  recoveryState: "idle",
  checkpointInFlight: null,
  lastQueryPlan: null,
  lastQueryMetrics: null,
  engineWarnings: [],
  groundTruth: null,
  caseInfo: null,
  runtimeInspector: null,
  heatmapMode: "streaming",
  selectedEventTime: null,
  selectedService: null,
  hoveredService: null,
  selectedTrace: null,
  selectedOperator: null,
  selectedChangeId: null,
  selectedHeatmapCell: null,
  tourTarget: null,
  replayCompleted: false,
  // Closed on load: the rail opens on the checklist and the evidence
  // timeline, and the Case brief chip opens the brief.
  briefOpen: false,
  briefRead: false,
  visitedTabs: [],
  playedOnce: false,
  anomalyOnsetNs: null,
  sawAnomaly: false,
  sawRanking: false,
  progressMuted: false,
  firstVisit: false,
  walkStep: null,
  runtimeTab: "pipeline",
  querySeed: null,
  groundTruthRevealed: false,
  setSession: (id) => set({ sessionId: id }),
  setIncident: (id) => set({ incidentId: id }),
  setTab: (tab) =>
    set((s) => ({
      activeTab: tab,
      visitedTabs:
        s.visitedTabs.includes(tab) || s.walkStep != null || s.progressMuted
          ? s.visitedTabs
          : [...s.visitedTabs, tab],
      // Opening the ranking drawer counts as reading the ranking.
      sawRanking: s.sawRanking || (tab === "root-causes" && s.walkStep == null && !s.progressMuted),
    })),
  setIncidentRange: (start, end) => set({ incidentStartNs: start, incidentEndNs: end }),
  setConnected: (v) => set({ connected: v }),
  wsOpened: () => set({ connected: true, wsStatus: "live", wsRetries: 0 }),
  wsClosed: () =>
    set((s) => ({ connected: false, wsStatus: "reconnecting", wsRetries: s.wsRetries + 1 })),
  setError: (e) => set({ lastError: e }),
  setGroundTruth: (g) => set({ groundTruth: g }),
  setCaseInfo: (c) => set({ caseInfo: c }),
  clearNeedsResync: () => set({ needsResync: false, lastError: null }),
  clearSelection: () =>
    set({
      selectedService: null,
      hoveredService: null,
      selectedTrace: null,
      selectedEventTime: null,
      selectedOperator: null,
      selectedChangeId: null,
      selectedHeatmapCell: null,
      tourTarget: null,
      replayCompleted: false,
      groundTruthRevealed: false,
      caseInfo: null,
      briefOpen: false,
      briefRead: false,
      visitedTabs: [],
      playedOnce: false,
      anomalyOnsetNs: null,
      sawAnomaly: false,
      sawRanking: false,
      progressMuted: false,
      topology: null,
      timeline: null,
      heatmap: null,
      traces: null,
      correlations: [],
      rootCauses: null,
      evidenceGraph: null,
      lastCheckpoint: null,
      recoveryReport: null,
      recoveryState: "idle",
      checkpointInFlight: null,
      lastQueryPlan: null,
      lastQueryMetrics: null,
      engineWarnings: [],
      lastSequence: 0,
      needsResync: false,
    }),
  selectService: (s) => set({ selectedService: s }),
  hoverService: (s) => set({ hoveredService: s }),
  selectTrace: (t) => set({ selectedTrace: t }),
  selectTime: (t) => set({ selectedEventTime: t }),
  selectOperator: (id) => set({ selectedOperator: id }),
  selectChange: (id) => set({ selectedChangeId: id }),
  selectHeatmapCell: (c) => set({ selectedHeatmapCell: c }),
  setTourTarget: (t) => set({ tourTarget: t }),
  setWalkStep: (n) => set({ walkStep: n }),
  setRuntimeTab: (t) => set({ runtimeTab: t }),
  seedQuery: (sql) => set({ querySeed: sql }),
  markGroundTruthRevealed: () => set({ groundTruthRevealed: true }),
  setBriefOpen: (open, opts) =>
    set((s) => ({
      briefOpen: open,
      briefRead: s.briefRead || (!open && opts?.read === true),
      // Closing the brief while a ranking exists means it is in view.
      sawRanking:
        s.sawRanking ||
        (!open && s.walkStep == null && !s.progressMuted && s.rootCauses?.incident_onset_ns != null),
    })),
  setFirstVisit: (v) => set({ firstVisit: v }),
  muteProgress: () => set({ progressMuted: true }),
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
        const end = get().incidentEndNs;
        if (
          get().replay.state === "playing" &&
          st.state === "stopped" &&
          end != null &&
          (st.event_time_ns ?? -1) >= end
        ) {
          patch.replayCompleted = true;
        }
        patch.replay = st;
        if (st.heatmap_mode) patch.heatmapMode = st.heatmap_mode;
        if (st.state === "playing") {
          patch.briefOpen = false;
          if (get().walkStep == null && !get().progressMuted) patch.playedOnce = true;
        }
        break;
      }
      case "clock.tick": {
        const tick = (msg.payload as { event_time_ns: number }).event_time_ns;
        const end = get().incidentEndNs;
        if (get().replay.state === "playing" && end != null && tick >= end) {
          patch.replayCompleted = true;
        }
        patch.selectedEventTime = tick;
        break;
      }
      case "topology.snapshot":
        patch.topology = msg.payload as TopologyPayload;
        break;
      case "timeline.append":
        patch.timeline = msg.payload as TimelinePayload;
        break;
      case "heatmap.delta":
        patch.heatmap = msg.payload as HeatmapPayload;
        break;
      case "correlation.snapshot": {
        const corr = msg.payload as CorrelationPayload;
        patch.correlations = corr.correlations ?? [];
        break;
      }
      case "root_causes.snapshot": {
        const rc = msg.payload as RootCausePayload;
        patch.rootCauses = rc;
        const s = get();
        if (
          !s.sawRanking &&
          !s.briefOpen &&
          s.walkStep == null &&
          !s.progressMuted &&
          rc.incident_onset_ns != null
        ) {
          patch.sawRanking = true;
        }
        break;
      }
      case "evidence.updated": {
        const graph = msg.payload as EvidenceGraphPayload;
        patch.evidenceGraph = graph;
        patch.anomalyOnsetNs = anomalyOnsetNs(graph);
        break;
      }
      case "checkpoint.started":
        patch.checkpointInFlight =
          (msg.payload as { checkpoint_id?: string }).checkpoint_id ?? "pending";
        break;
      case "checkpoint.completed":
        patch.lastCheckpoint = msg.payload as CheckpointMetrics;
        patch.checkpointInFlight = null;
        break;
      case "engine.warning": {
        const w = msg.payload as { message?: string };
        patch.engineWarnings = [
          ...get().engineWarnings,
          { message: w.message ?? "engine warning", sequence: msg.sequence, server_time_ns: msg.server_time_ns },
        ].slice(-20);
        break;
      }
      case "query.plan":
        patch.lastQueryPlan = msg.payload as ExplainOutput;
        break;
      case "query.metrics":
        patch.lastQueryMetrics = msg.payload as ExecMetrics;
        break;
      case "recovery.started":
        patch.recoveryState = "recovering";
        break;
      case "recovery.completed":
        patch.recoveryReport = msg.payload as RecoveryReport;
        patch.recoveryState = "recovered";
        break;
      case "runtime.inspector": {
        const inspector = msg.payload as RuntimeInspector;
        patch.runtimeInspector = inspector;
        if (inspector.session?.projection_mode) {
          patch.heatmapMode = inspector.session.projection_mode;
        }
        break;
      }
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
    // The dependency graph turns red once the cursor passes the earliest
    // anomaly; latch it whenever a tick, status or evidence update lands.
    const cur = get();
    const onset = patch.anomalyOnsetNs ?? cur.anomalyOnsetNs;
    const cursor = patch.selectedEventTime ?? cur.selectedEventTime;
    // The mute lifts once the replay reports the cursor back at the start.
    let muted = cur.progressMuted;
    if (muted && cursor != null && cur.incidentStartNs != null && cursor <= cur.incidentStartNs) {
      muted = false;
      patch.progressMuted = false;
    }
    if (!cur.sawAnomaly && cur.walkStep == null && !muted && onset != null && cursor != null && cursor >= onset) {
      patch.sawAnomaly = true;
    }
    set(patch);
  },
}));
