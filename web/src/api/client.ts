import type { WsEnvelope } from "../types/protocol";
import { useInvestigation, type GroundTruth } from "../state/investigation";

export type { GroundTruth };

export type StreamHandle = {
  close: () => void;
};

export async function createSession(): Promise<string> {
  const r = await fetch("/api/v1/sessions", { method: "POST" });
  if (!r.ok) throw new Error("create session failed");
  const j = await r.json();
  return j.session_id as string;
}

export async function loadIncident(
  sessionId: string,
  incidentId: string,
  opts?: { adversarial?: boolean },
) {
  const r = await fetch(`/api/v1/sessions/${sessionId}/load`, {
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

export async function setProjectionMode(sessionId: string, mode: "streaming" | "precomputed") {
  await fetch(`/api/v1/sessions/${sessionId}/projection-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export async function play(sessionId: string) {
  await fetch(`/api/v1/sessions/${sessionId}/play`, { method: "POST" });
}

export async function pause(sessionId: string) {
  await fetch(`/api/v1/sessions/${sessionId}/pause`, { method: "POST" });
}

export async function seek(sessionId: string, event_time_ns: number) {
  await fetch(`/api/v1/sessions/${sessionId}/seek`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_time_ns }),
  });
}

export async function setSpeed(sessionId: string, speed: string) {
  await fetch(`/api/v1/sessions/${sessionId}/speed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speed }),
  });
}

export async function reset(sessionId: string) {
  await fetch(`/api/v1/sessions/${sessionId}/reset`, { method: "POST" });
}

export async function resync(sessionId: string) {
  await fetch(`/api/v1/sessions/${sessionId}/resync`, { method: "POST" });
}

export async function fetchTrace(traceId: string) {
  const r = await fetch(`/api/v1/traces/${encodeURIComponent(traceId)}`);
  if (!r.ok) throw new Error("trace not found");
  return r.json();
}

export function connectStream(sessionId: string): StreamHandle {
  let stopped = false;
  let socket: WebSocket | null = null;

  const open = () => {
    if (stopped) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/v1/sessions/${sessionId}/stream`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      useInvestigation.getState().setConnected(true);
      void resync(sessionId).catch(() => {
        useInvestigation.getState().setError("resync after connect failed");
      });
    };
    ws.onclose = () => {
      useInvestigation.getState().setConnected(false);
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
