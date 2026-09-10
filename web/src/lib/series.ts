import type { Scenario } from "../content/scenarios";

// The injected metric's exact name in the fixtures: `<service>_<kind>`.
// Memory and cpu faults carry `mem` / `cpu`; latency faults surface on the
// latency series, which the RCAEval adapter names `latency-50`
// (python/faultline_data/adapters/rcaeval.py) and the synthetic generators
// name `latency`.
export function faultMetricName(scenario: Pick<Scenario, "source" | "schematic">): string {
  const { origin, signal } = scenario.schematic;
  if (signal === "memory") return `${origin}_mem`;
  if (signal === "cpu") return `${origin}_cpu`;
  return scenario.source === "rcaeval-re2ob" ? `${origin}_latency-50` : `${origin}_latency`;
}

// Same metric on another service (the nearest caller), for contrast.
export function metricNameFor(service: string, scenario: Pick<Scenario, "source" | "schematic">): string {
  const base = faultMetricName(scenario);
  return `${service}${base.slice(scenario.schematic.origin.length)}`;
}

// LIKE fallback when the exact name returns no rows.
export function faultMetricLike(signal: Scenario["schematic"]["signal"]): string {
  if (signal === "memory") return "%mem%";
  if (signal === "cpu") return "%cpu%";
  return "%latency%";
}

// Bucket width for long recordings: smallest of 2/4/8/16 s that keeps the
// series at or under ~200 points. Short recordings are read raw.
export function bucketSizeS(spanS: number): number | null {
  if (spanS <= 60) return null;
  for (const b of [2, 4, 8, 16]) if (spanS / b <= 200) return b;
  return 16;
}

function quote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

// SQL for one series at the cursor. Raw rows for short spans; TUMBLE + AVG
// for long ones. No ORDER BY (it requires LIMIT and alias sorting is
// untested); the client sorts.
export function seriesSql(
  service: string,
  name: string,
  spanS: number,
  opts: { like?: boolean } = {},
): string {
  const nameClause = opts.like ? `name LIKE ${quote(name)}` : `name = ${quote(name)}`;
  const where = `service = ${quote(service)} AND ${nameClause}`;
  const b = bucketSizeS(spanS);
  if (b == null) {
    return `SELECT event_time, value FROM metrics WHERE ${where} LIMIT 4000`;
  }
  return `SELECT TUMBLE(event_time, '${b}s') AS t, AVG(value) AS v FROM metrics WHERE ${where} GROUP BY service LIMIT 400`;
}

export type SeriesPoint = { t: number; v: number };

function num(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Rows from either query shape into sorted points. Raw rows carry
// event_time/value; bucketed rows carry t (window start) and v.
export function parseSeriesRows(rows: Array<Record<string, unknown>>): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const r of rows) {
    const t = num(r.event_time ?? r.t ?? r.window_start);
    const v = num(r.value ?? r.v);
    if (t == null || v == null) continue;
    out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
