import { fetchTrace } from "../api/client";
import type { TraceDetail } from "../types/protocol";

// Trace details keyed by session and trace id, shared between the Telemetry
// waterfall and the Case file route sample. Only complete DAGs are cached: an
// incomplete one grows as the cursor advances and must be refetched.
const cache = new Map<string, TraceDetail>();
const inflight = new Map<string, Promise<TraceDetail>>();

function key(sessionId: string, traceId: string): string {
  return `${sessionId}|${traceId}`;
}

export function peekTrace(sessionId: string, traceId: string): TraceDetail | undefined {
  return cache.get(key(sessionId, traceId));
}

export async function fetchTraceCached(sessionId: string, traceId: string): Promise<TraceDetail> {
  const k = key(sessionId, traceId);
  const hit = cache.get(k);
  if (hit) return hit;
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = fetchTrace(sessionId, traceId)
    .then((d) => {
      if (!d.dag?.incomplete) cache.set(k, d);
      return d;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

export function clearTraceCache(): void {
  cache.clear();
  inflight.clear();
}
