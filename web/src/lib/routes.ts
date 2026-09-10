import type { TraceDetail, TraceSpan } from "../types/protocol";
import { traceStatus } from "./traceSelect";

// Request routes: the ordered chain of services a request passed through,
// root to leaf along parent links. With a critical path, the chain is the
// parent chain of the deepest critical span (the critical path is a
// root-to-leaf path, but its spans ordered by start time would bounce between
// a caller and its siblings); otherwise the root-to-deepest-leaf chain.

export function chainFromTrace(detail: TraceDetail): string[] {
  const spans = detail.dag?.spans ?? [];
  if (spans.length === 0) return [];
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const critical = new Set(detail.critical_path?.span_ids ?? []);
  let ordered: TraceSpan[];
  if (critical.size > 0) {
    const depth = (s: TraceSpan): number => {
      let d = 0;
      let cur: TraceSpan | undefined = s;
      while (cur?.parent_span_id && byId.has(cur.parent_span_id) && d < 64) {
        cur = byId.get(cur.parent_span_id);
        d += 1;
      }
      return d;
    };
    let deepest: TraceSpan | null = null;
    let best = -1;
    for (const id of critical) {
      const s = byId.get(id);
      if (!s) continue;
      const d = depth(s);
      if (d > best || (d === best && deepest && s.start_time_ns < deepest.start_time_ns)) {
        best = d;
        deepest = s;
      }
    }
    ordered = deepest ? parentChain(deepest, byId) : deepestChain(spans, byId);
  } else {
    ordered = deepestChain(spans, byId);
  }
  const chain: string[] = [];
  for (const s of ordered) {
    const svc = s.service ?? "?";
    if (chain[chain.length - 1] !== svc) chain.push(svc);
  }
  return chain;
}

function parentChain(leaf: TraceSpan, byId: Map<string, TraceSpan>): TraceSpan[] {
  const out: TraceSpan[] = [leaf];
  let cur: TraceSpan | undefined = leaf;
  let guard = 0;
  while (cur?.parent_span_id && byId.has(cur.parent_span_id) && guard < 64) {
    cur = byId.get(cur.parent_span_id);
    if (cur) out.push(cur);
    guard += 1;
  }
  return out.reverse();
}

function deepestChain(spans: TraceSpan[], byId: Map<string, TraceSpan>): TraceSpan[] {
  const children = new Map<string, TraceSpan[]>();
  const roots: TraceSpan[] = [];
  for (const s of spans) {
    const parent = s.parent_span_id ?? null;
    if (parent && byId.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), s]);
    } else {
      roots.push(s);
    }
  }
  let best: TraceSpan[] = [];
  const walk = (s: TraceSpan, path: TraceSpan[], guard: number) => {
    const next = [...path, s];
    const kids = children.get(s.span_id) ?? [];
    if (kids.length === 0 || guard > 64) {
      if (next.length > best.length) best = next;
      return;
    }
    for (const k of kids) walk(k, next, guard + 1);
  };
  for (const r of roots.sort((a, b) => a.start_time_ns - b.start_time_ns)) walk(r, [], 0);
  return best;
}

export type RouteRow = {
  key: string;
  chain: string[];
  sampled: number;
  failed: number;
  medianDurationNs: number | null;
  throughOrigin: boolean;
};

// Distinct chains across a sample of trace details, most sampled first, the
// route through the origin service first among equals.
export function aggregateRoutes(details: TraceDetail[], origin: string | null): RouteRow[] {
  const rows = new Map<string, { chain: string[]; sampled: number; failed: number; durations: number[] }>();
  for (const d of details) {
    const chain = chainFromTrace(d);
    if (chain.length === 0) continue;
    const key = chain.join(">");
    const row = rows.get(key) ?? { chain, sampled: 0, failed: 0, durations: [] };
    row.sampled += 1;
    if (traceStatus(d.dag?.spans ?? []) === "error") row.failed += 1;
    const total = d.critical_path?.total_duration_ns;
    if (total != null && Number.isFinite(total)) row.durations.push(total);
    rows.set(key, row);
  }
  const out: RouteRow[] = [];
  for (const [key, r] of rows) {
    const sorted = [...r.durations].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
    out.push({
      key,
      chain: r.chain,
      sampled: r.sampled,
      failed: r.failed,
      medianDurationNs: median,
      throughOrigin: origin != null && r.chain.includes(origin),
    });
  }
  out.sort((a, b) => {
    if (a.throughOrigin !== b.throughOrigin) return a.throughOrigin ? -1 : 1;
    if (b.sampled !== a.sampled) return b.sampled - a.sampled;
    return a.key.localeCompare(b.key);
  });
  return out;
}

// Which trace ids to sample: failed ones first (they are the informative
// routes), then ids spread evenly through the listed order so the sample is
// not all early, healthy traces.
export function sampleTraceIds(listed: string[], failed: string[], max = 8): string[] {
  const set = new Set(listed);
  const out: string[] = [];
  for (const id of failed) {
    if (set.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) return out;
  }
  const remaining = listed.filter((id) => !out.includes(id));
  const need = max - out.length;
  if (need <= 0 || remaining.length === 0) return out;
  if (remaining.length <= need) return [...out, ...remaining];
  for (let i = 0; i < need; i++) {
    const idx = Math.floor((i * (remaining.length - 1)) / Math.max(1, need - 1));
    const id = remaining[idx];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
