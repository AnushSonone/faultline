// Evidence ticks under the scrubber. One dot per evidence node works on the
// synthetic fixtures (about 15 nodes) but not on an RCAEval recording, where
// several hundred 5px dots pack edge to edge into a solid band that reads as
// a second timeline. Thin them by position, keeping the landmarks.

export type TickNode = {
  id: string;
  kind: string;
  time_ns?: number | null;
};

// Landmarks first: a deploy or a degradation says more than one more anomaly
// in a run of hundreds.
const PRIORITY: Record<string, number> = {
  change: 0,
  service_degradation: 1,
  log_pattern: 2,
  metric_anomaly: 3,
};

function rank(kind: string): number {
  return PRIORITY[kind] ?? 4;
}

export const TICK_BUCKETS = 48; // about one tick per 6px on the narrowest track
export const MAX_TICKS = 40;
// Past this many metric anomalies the row says nothing except "many": an
// RCAEval recording carries over a thousand. Keep the landmarks instead, the
// same call the transport already makes for log markers.
export const MAX_ANOMALY_TICKS = 40;

export type ThinOptions = {
  buckets?: number;
  max?: number;
  maxAnomalies?: number;
};

// Keep at most one node per position bucket, chosen by kind, then cap the
// total. Output stays in time order so the row reads left to right.
export function thinTicks<T extends TickNode>(
  nodes: T[],
  toFrac: (ns: number) => number,
  opts: ThinOptions = {},
): T[] {
  const buckets = opts.buckets ?? TICK_BUCKETS;
  const max = opts.max ?? MAX_TICKS;
  const maxAnomalies = opts.maxAnomalies ?? MAX_ANOMALY_TICKS;
  let anomalies = 0;
  for (const n of nodes) if (n.kind === "metric_anomaly" && n.time_ns != null) anomalies++;
  const dropAnomalies = anomalies > maxAnomalies;
  const best = new Map<number, T>();
  for (const n of nodes) {
    if (n.time_ns == null) continue;
    if (n.kind === "root_cause_candidate") continue;
    if (dropAnomalies && n.kind === "metric_anomaly") continue;
    const f = Math.min(1, Math.max(0, toFrac(n.time_ns)));
    const bucket = Math.round(f * buckets);
    const held = best.get(bucket);
    if (held == null || rank(n.kind) < rank(held.kind)) best.set(bucket, n);
  }
  const kept = [...best.values()].sort((a, b) => a.time_ns! - b.time_ns!);
  if (kept.length <= max) return kept;
  // Still too many: drop the lowest-priority ones, then re-sort by time.
  const byPriority = [...kept].sort((a, b) => rank(a.kind) - rank(b.kind));
  return byPriority.slice(0, max).sort((a, b) => a.time_ns! - b.time_ns!);
}
