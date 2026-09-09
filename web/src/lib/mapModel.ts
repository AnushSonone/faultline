// Derived model for the dependency map at the current cursor. Pure so the
// heat/hot/badge rules are unit-tested, and so cytoscape only ever receives
// plain data.

import type {
  CorrelationPayload,
  EvidenceGraphPayload,
  HeatmapCell,
  HeatmapPayload,
  RootCausePayload,
  TopologyPayload,
} from "../types/protocol";

export type MapNode = {
  id: string;
  observed: boolean; // has spans in the topology; false = metrics only
  requestCount: number;
  errorRate: number;
  // 0..1: the larger of latency vs the service's own early baseline at the
  // cursor, and the strongest anomaly/degradation evidence known by then.
  heat: number;
  hot: boolean;
  rank: number | null;
  score: number | null;
  deployed: boolean;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  propagating: boolean;
};

export type MapModel = {
  nodes: MapNode[];
  edges: MapEdge[];
  roots: string[];
};

export type MapInputs = {
  topology: TopologyPayload | null;
  heatmap: HeatmapPayload | null;
  rootCauses: RootCausePayload | null;
  correlations: CorrelationPayload["correlations"];
  evidenceGraph?: EvidenceGraphPayload | null;
  cursorNs: number | null;
};

export const HOT_HEAT = 0.3;
export const HOT_ERROR_RATE = 0.05;
// heat reaches 1 when the value is this many times its baseline
const FULL_HEAT_MULTIPLE = 3;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Heat at the cursor: latest cell at or before the cursor, normalised against
// the median of the service's first three buckets (its "own normal").
export function heatAt(cells: HeatmapCell[], cursorNs: number | null): number {
  if (cells.length === 0) return 0;
  const sorted = [...cells].sort((a, b) => a.bucket_start_ns - b.bucket_start_ns);
  const base = median(sorted.slice(0, 3).map((c) => c.value));
  let current: HeatmapCell | null = null;
  for (const c of sorted) {
    if (cursorNs != null && c.bucket_start_ns > cursorNs) break;
    current = c;
  }
  if (!current) return 0;
  if (base <= 0) return current.value > 0 ? 1 : 0;
  const ratio = current.value / base - 1;
  return Math.max(0, Math.min(1, ratio / (FULL_HEAT_MULTIPLE - 1)));
}

// Strongest evidence per service at the cursor (metric anomalies and
// degradations only; candidates are the output, not the input).
export function evidenceHeat(
  graph: EvidenceGraphPayload | null | undefined,
  cursorNs: number | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of graph?.graph.nodes ?? []) {
    if (!n.service) continue;
    if (n.kind !== "metric_anomaly" && n.kind !== "service_degradation") continue;
    if (cursorNs != null && n.time_ns != null && n.time_ns > cursorNs) continue;
    const s = Math.max(0, Math.min(1, n.strength));
    if (s > (out.get(n.service) ?? 0)) out.set(n.service, s);
  }
  return out;
}

export function buildMapModel(input: MapInputs): MapModel {
  const { topology, heatmap, rootCauses, correlations, evidenceGraph, cursorNs } = input;
  const evidence = evidenceHeat(evidenceGraph, cursorNs);
  const cellsByService = new Map<string, HeatmapCell[]>();
  for (const c of heatmap?.cells ?? []) {
    const list = cellsByService.get(c.service) ?? [];
    list.push(c);
    cellsByService.set(c.service, list);
  }
  const topoNodes = new Map<string, { request_count?: number; error_count?: number }>();
  for (const n of topology?.graph.nodes ?? []) topoNodes.set(n.service, n);

  const rankBy = new Map<string, { rank: number; score: number }>();
  for (const c of rootCauses?.candidates ?? []) rankBy.set(c.service, { rank: c.rank, score: c.score });

  const deployed = new Set<string>();
  for (const c of correlations) {
    if (cursorNs == null || c.deployed_at_ns <= cursorNs) deployed.add(c.service);
  }

  const ids = new Set<string>([
    ...topoNodes.keys(),
    ...cellsByService.keys(),
    ...rankBy.keys(),
    ...evidence.keys(),
  ]);
  const nodes: MapNode[] = [...ids].sort().map((id) => {
    const t = topoNodes.get(id);
    const req = Number(t?.request_count ?? 0);
    const err = Number(t?.error_count ?? 0);
    const errorRate = req > 0 ? err / req : 0;
    const heat = Math.max(heatAt(cellsByService.get(id) ?? [], cursorNs), evidence.get(id) ?? 0);
    const r = rankBy.get(id);
    return {
      id,
      observed: topoNodes.has(id),
      requestCount: req,
      errorRate,
      heat,
      hot: heat >= HOT_HEAT || errorRate > HOT_ERROR_RATE,
      rank: r?.rank ?? null,
      score: r?.score ?? null,
      deployed: deployed.has(id),
    };
  });
  const hot = new Set(nodes.filter((n) => n.hot).map((n) => n.id));

  const edges: MapEdge[] = (topology?.graph.edges ?? []).map((e, i) => ({
    id: `e-${i}-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    propagating: hot.has(e.from) && hot.has(e.to),
  }));

  const hasIncoming = new Set(edges.map((e) => e.target));
  const roots = nodes.filter((n) => n.observed && !hasIncoming.has(n.id)).map((n) => n.id);

  return { nodes, edges, roots };
}

// Identity of the drawn graph: re-layout only when this changes.
export function mapSignature(model: MapModel): string {
  return `${model.nodes.map((n) => `${n.id}:${n.observed ? 1 : 0}`).join("|")}#${model.edges
    .map((e) => `${e.source}->${e.target}`)
    .join("|")}`;
}

// Layered positions: callers left of callees (longest-path depth from the
// roots), siblings stacked vertically, metrics-only services in a row under
// the traced graph. The pitches leave room for a label under each node, which
// cytoscape's breadthfirst does not guarantee, and the left-to-right flow
// suits the wide, short map panel.
export type MapDirection = "horizontal" | "vertical";

export type MapLayoutOptions = {
  rowGap?: number; // pitch between siblings at the same depth
  colGap?: number; // pitch between depths
  orphanGap?: number; // clearance between the deepest level and the metrics-only row
  // horizontal: depth runs left -> right (wide panels);
  // vertical: depth runs top -> bottom (tall, narrow panels).
  direction?: MapDirection;
  depthPitch?: number; // vertical only: pitch between depths (node + label)
};

export function layoutMap(
  model: MapModel,
  opts: MapLayoutOptions = {},
): Record<string, { x: number; y: number }> {
  const rowGap = opts.rowGap ?? 90;
  const colGap = opts.colGap ?? 190;
  const orphanGap = opts.orphanGap ?? 70;
  const vertical = opts.direction === "vertical";
  const depthPitch = opts.depthPitch ?? 120;
  const observed = model.nodes.filter((n) => n.observed).map((n) => n.id);
  const out = new Map<string, string[]>();
  for (const id of observed) out.set(id, []);
  for (const e of model.edges) out.get(e.source)?.push(e.target);

  // Drop back edges (DFS from the roots) so the longest-path pass below runs
  // on a DAG and terminates with stable depths even on cyclic topologies.
  const roots = model.roots.length ? model.roots : observed.slice(0, 1);
  const state = new Map<string, "open" | "done">();
  const dag = new Map<string, string[]>();
  for (const id of observed) dag.set(id, []);
  const visit = (id: string) => {
    state.set(id, "open");
    for (const t of out.get(id) ?? []) {
      const st = state.get(t);
      if (st === "open") continue; // back edge
      dag.get(id)!.push(t);
      if (st == null) visit(t);
    }
    state.set(id, "done");
  };
  for (const r of roots) if (!state.has(r)) visit(r);
  for (const id of observed) if (!state.has(id)) visit(id);

  const depth = new Map<string, number>();
  for (const r of roots) depth.set(r, 0);
  for (let iter = 0; iter < observed.length + 1; iter++) {
    let changed = false;
    for (const [src, targets] of dag) {
      const d = depth.get(src);
      if (d == null) continue;
      for (const t of targets) {
        if ((depth.get(t) ?? -1) < d + 1) {
          depth.set(t, d + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (const id of observed) if (!depth.has(id)) depth.set(id, 0);

  const rows = new Map<number, string[]>();
  for (const id of observed) {
    const d = depth.get(id)!;
    rows.set(d, [...(rows.get(d) ?? []), id]);
  }
  const positions: Record<string, { x: number; y: number }> = {};
  let maxDepth = -1;
  let maxRows = 0;
  for (const [d, ids] of rows) {
    ids.sort();
    ids.forEach((id, i) => {
      // Vertical: depths stack with a compact pitch, siblings sit side by
      // side at the wide pitch so their labels never touch.
      const along = d * (vertical ? depthPitch : colGap);
      const across = (i - (ids.length - 1) / 2) * (vertical ? colGap : rowGap);
      positions[id] = vertical ? { x: across, y: along } : { x: along, y: across };
    });
    maxDepth = Math.max(maxDepth, d);
    maxRows = Math.max(maxRows, ids.length);
  }
  const orphans = model.nodes.filter((n) => !n.observed).map((n) => n.id).sort();
  if (vertical) {
    // A row under the deepest level, centred on the depth axis, spread by
    // the sibling pitch (they are siblings of a kind).
    const oy = maxDepth >= 0 ? maxDepth * depthPitch + orphanGap + depthPitch / 2 : 0;
    orphans.forEach((id, i) => {
      positions[id] = { x: (i - (orphans.length - 1) / 2) * colGap, y: oy };
    });
  } else {
    const oy = maxRows > 0 ? ((maxRows - 1) / 2) * rowGap + orphanGap : 0;
    const cx = maxDepth >= 0 ? (maxDepth * colGap) / 2 : 0;
    orphans.forEach((id, i) => {
      positions[id] = { x: cx + (i - (orphans.length - 1) / 2) * colGap, y: oy };
    });
  }
  return positions;
}
