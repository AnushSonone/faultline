import type { WsEnvelope } from "../types/protocol";
import { useInvestigation, type GroundTruth } from "../state/investigation";

export type { GroundTruth };

export type StreamHandle = {
  close: () => void;
};

// Base origin for API calls. Empty (default) keeps same-origin relative URLs
// for the standalone app; the blog embed points this at the demo host.
let API_BASE = "";

export function setApiBase(origin: string) {
  API_BASE = origin.replace(/\/+$/, "");
}

function api(path: string): string {
  return `${API_BASE}${path}`;
}

// Raised when the server sheds load (503 on session create). The boot path
// shows a friendly capacity screen for this instead of the error toast.
export class DemoBusyError extends Error {
  constructor() {
    super("demo_busy");
    this.name = "DemoBusyError";
  }
}

export async function createSession(): Promise<string> {
  const r = await fetch(api("/api/v1/sessions"), { method: "POST" });
  if (r.status === 503) throw new DemoBusyError();
  if (!r.ok) throw new Error("create session failed");
  const j = await r.json();
  return j.session_id as string;
}

export type IncidentSummary = {
  incident_id: string;
  dataset_id: string;
  dataset_version: string;
  path: string;
};

export async function listIncidents(): Promise<IncidentSummary[]> {
  const r = await fetch(api("/api/v1/incidents"));
  if (!r.ok) throw new Error("incident list unavailable");
  return r.json() as Promise<IncidentSummary[]>;
}

export async function loadIncident(
  sessionId: string,
  incidentId: string,
  opts?: { adversarial?: boolean },
) {
  const r = await fetch(api(`/api/v1/sessions/${sessionId}/load`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incident_id: incidentId,
      adversarial: opts?.adversarial ?? false,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{
    session_id: string;
    incident_id: string;
    event_count: number;
    start_time_ns: number;
    end_time_ns: number;
    ground_truth?: GroundTruth;
  }>;
}

export type CaseInfo = {
  session_id: string;
  incident_id: string | null;
  system: string | null;
  dataset_id: string | null;
  dataset_version: string | null;
  signals: string[] | null;
  event_counts: Record<string, number> | null;
  start_time_ns: number | null;
  end_time_ns: number | null;
  adversarial: boolean;
  fault_type: string | null;
  fault_start_time_ns: number | null;
  fault_end_time_ns: number | null;
  notes: string | null;
  labels_gated: boolean;
  answer?: {
    source: string;
    not_inferred: boolean;
    root_cause_services: string[];
    root_cause_indicators: string[];
    expected_downstream_services: string[];
  };
};

export async function fetchCase(sessionId: string, reveal: boolean): Promise<CaseInfo> {
  const r = await fetch(api(`/api/v1/sessions/${sessionId}/case${reveal ? "?reveal=true" : ""}`));
  if (!r.ok) throw new Error("case metadata unavailable");
  return r.json() as Promise<CaseInfo>;
}

export async function setProjectionMode(sessionId: string, mode: "streaming" | "precomputed") {
  await fetch(api(`/api/v1/sessions/${sessionId}/projection-mode`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export async function play(sessionId: string) {
  await fetch(api(`/api/v1/sessions/${sessionId}/play`), { method: "POST" });
}

export async function pause(sessionId: string) {
  await fetch(api(`/api/v1/sessions/${sessionId}/pause`), { method: "POST" });
}

export async function seek(sessionId: string, event_time_ns: number) {
  await fetch(api(`/api/v1/sessions/${sessionId}/seek`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_time_ns }),
  });
}

export async function setSpeed(sessionId: string, speed: string) {
  await fetch(api(`/api/v1/sessions/${sessionId}/speed`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speed }),
  });
}

export async function reset(sessionId: string) {
  await fetch(api(`/api/v1/sessions/${sessionId}/reset`), { method: "POST" });
}

export async function resync(sessionId: string) {
  await fetch(api(`/api/v1/sessions/${sessionId}/resync`), { method: "POST" });
}

export async function checkpoint(sessionId: string) {
  const r = await fetch(api(`/api/v1/sessions/${sessionId}/checkpoint`), { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function crashTest(sessionId: string) {
  const r = await fetch(api(`/api/v1/sessions/${sessionId}/crash-test`), { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchTrace(traceId: string) {
  const r = await fetch(api(`/api/v1/traces/${encodeURIComponent(traceId)}`));
  if (!r.ok) throw new Error("trace not found");
  return r.json();
}

export function connectStream(sessionId: string): StreamHandle {
  let stopped = false;
  let socket: WebSocket | null = null;

  const open = () => {
    if (stopped) return;
    const base = API_BASE ? new URL(API_BASE) : window.location;
    const proto = base.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${base.host}/api/v1/sessions/${sessionId}/stream`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      useInvestigation.getState().wsOpened();
      void resync(sessionId).catch(() => {
        useInvestigation.getState().setError("resync after connect failed");
      });
    };
    ws.onclose = () => {
      useInvestigation.getState().wsClosed();
      if (!stopped) {
        window.setTimeout(open, 750);
      }
    };
    ws.onerror = () => useInvestigation.getState().setError("websocket error");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsEnvelope;
        const store = useInvestigation.getState();
        store.applyWs(msg);
        if (useInvestigation.getState().needsResync) {
          void resync(sessionId)
            .then(() => useInvestigation.getState().clearNeedsResync())
            .catch(() => store.setError("resync failed"));
        }
      } catch {
        useInvestigation.getState().setError("bad ws payload");
      }
    };
  };

  open();
  return {
    close: () => {
      stopped = true;
      socket?.close();
      socket = null;
    },
  };
}
