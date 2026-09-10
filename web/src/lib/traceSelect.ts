import type { TraceSpan } from "../types/protocol";

// Which trace the waterfall should show. Keeps a selection that is still
// listed at the cursor; otherwise the first listed failed trace (from the top
// candidate's failed_trace_ids); otherwise the first listed trace; null when
// nothing is listed. Pure, so the list republished on every tick can be
// reconciled cheaply.
export function reconcileSelection(
  listed: string[],
  selected: string | null,
  failed: string[],
): string | null {
  if (listed.length === 0) return null;
  if (selected != null && listed.includes(selected)) return selected;
  const set = new Set(listed);
  for (const id of failed) if (set.has(id)) return id;
  return listed[0];
}

export type TraceStatus = "error" | "ok" | "unknown";

export function traceStatus(spans: TraceSpan[]): TraceStatus {
  if (spans.length === 0) return "unknown";
  return spans.some((s) => String(s.status).toLowerCase() === "error") ? "error" : "ok";
}

// Extent of a trace in event time: [min start, max end].
export function traceExtent(spans: TraceSpan[]): { start: number; end: number } | null {
  if (spans.length === 0) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const s of spans) {
    if (s.start_time_ns < start) start = s.start_time_ns;
    if (s.end_time_ns > end) end = s.end_time_ns;
  }
  return { start, end };
}

// Depth of each span in the parent chain (roots and orphans at 0).
export function spanDepths(spans: TraceSpan[]): Map<string, number> {
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const depth = new Map<string, number>();
  const resolve = (id: string, guard = 0): number => {
    const known = depth.get(id);
    if (known != null) return known;
    const s = byId.get(id);
    const parent = s?.parent_span_id ?? null;
    const d = parent && byId.has(parent) && guard < 64 ? resolve(parent, guard + 1) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const s of spans) resolve(s.span_id);
  return depth;
}
