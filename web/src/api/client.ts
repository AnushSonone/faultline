import type { WsEnvelope } from "../types/protocol";
import { useInvestigation } from "../state/investigation";

export async function createSession(): Promise<string> {
  const r = await fetch("/api/v1/sessions", { method: "POST" });
  if (!r.ok) throw new Error("create session failed");
  const j = await r.json();
  return j.session_id as string;
}

export async function loadIncident(sessionId: string, incidentId: string) {
  const r = await fetch(`/api/v1/sessions/${sessionId}/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incident_id: incidentId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

export async function fetchTrace(traceId: string) {
  const r = await fetch(`/api/v1/traces/${encodeURIComponent(traceId)}`);
  if (!r.ok) throw new Error("trace not found");
  return r.json();
}

export function connectStream(sessionId: string): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  // Prefer same-origin so Vite WS proxy works in dev.
  const url = `${proto}://${window.location.host}/api/v1/sessions/${sessionId}/stream`;
  const ws = new WebSocket(url);
  const store = useInvestigation.getState();
  ws.onopen = () => store.setConnected(true);
  ws.onclose = () => store.setConnected(false);
  ws.onerror = () => store.setError("websocket error");
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsEnvelope;
      useInvestigation.getState().applyWs(msg);
    } catch {
      store.setError("bad ws payload");
    }
  };
  return ws;
}
