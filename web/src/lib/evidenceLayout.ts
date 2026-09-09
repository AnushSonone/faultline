// Deterministic lane layout for the evidence graph.
//
// Lanes (left to right) follow the causal reading order: what changed, what
// the metrics did, which services degraded, who is ranked. Inside every lane
// nodes are grouped by service so a degradation sits beside its own anomalies
// and its own candidate row, which keeps edges short and labels apart. The
// output is a cytoscape `preset` position map, so a node only ever moves when
// a new node lands in its own group.
//
// Pure: label measurement is injected so the layout is unit-testable and the
// browser can pass a canvas measureText in the font cytoscape renders with.

import { candidateRank, shortEvidenceLabel } from "./labels";

export type LayoutNode = {
  id: string;
  kind: string;
  label: string;
  service?: string | null;
  time_ns?: number | null;
  strength: number;
  // Condensed nodes (lib/evidenceCondense): raw count and verbatim summary.
  count?: number;
  summary?: string;
};

export type Placed = {
  id: string;
  x: number;
  y: number;
  lane: number;
  label: string;
};

export type EvidenceLayout = {
  positions: Record<string, { x: number; y: number }>;
  placed: Placed[];
  laneX: number[];
  width: number;
  height: number;
  rows: number;
};

export const LANES = ["change", "metric_anomaly", "service_degradation", "root_cause_candidate"] as const;

export const LANE_TITLES = ["1 · what changed", "2 · went strange", "3 · got slow", "4 · suspects"];

export function laneOf(kind: string): number {
  switch (kind) {
    case "change":
    case "log_pattern":
      return 0;
    case "metric_anomaly":
      return 1;
    case "service_degradation":
      return 2;
    case "root_cause_candidate":
      return 3;
    default:
      return 1;
  }
}

export type LayoutOptions = {
  measure: (text: string) => number;
  // Width of a lane header as drawn (uppercase, tracked); defaults to measure.
  measureHead?: (text: string) => number;
  // Explicit service-group order (see evidenceOrder.ts). Services present in
  // `nodes` but missing here are appended by name. Default: rank order.
  order?: string[];
  // Compact canvas labels (see labels.ts). Default false.
  compact?: boolean;
  rowPitch?: number;
  nodeSize?: number;
  labelGap?: number;
  laneGap?: number;
  groupGap?: number;
  padding?: number;
};

const DEFAULTS = {
  rowPitch: 30,
  nodeSize: 16,
  labelGap: 8,
  laneGap: 40,
  groupGap: 0.6,
  padding: 12,
};

function serviceOrder(nodes: LayoutNode[]): string[] {
  const ranked = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "root_cause_candidate" || !n.service) continue;
    const r = candidateRank(n.label);
    ranked.set(n.service, r ?? 1000 - n.strength * 100);
  }
  const all = new Set<string>();
  for (const n of nodes) if (n.service) all.add(n.service);
  return [...all].sort((a, b) => {
    const ra = ranked.get(a) ?? Number.POSITIVE_INFINITY;
    const rb = ranked.get(b) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function byTimeThenId(a: LayoutNode, b: LayoutNode): number {
  const ta = a.time_ns ?? Number.POSITIVE_INFINITY;
  const tb = b.time_ns ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

export function layoutEvidence(nodes: LayoutNode[], opts: LayoutOptions): EvidenceLayout {
  const o = { ...DEFAULTS, ...opts };
  const groups = opts.order
    ? [
        ...opts.order,
        ...[...new Set(nodes.map((n) => n.service).filter((s): s is string => !!s))]
          .filter((s) => !opts.order!.includes(s))
          .sort(),
      ]
    : serviceOrder(nodes);
  const groupKey = (n: LayoutNode) => n.service ?? "";
  const keys = [...groups, ""];

  // rows per group = tallest lane in that group
  type Slot = { node: LayoutNode; lane: number; row: number };
  const slots: Slot[] = [];
  let row = 0;
  for (const key of keys) {
    const members = nodes.filter((n) => groupKey(n) === key);
    if (members.length === 0) continue;
    const perLane: LayoutNode[][] = [[], [], [], []];
    for (const n of members) perLane[laneOf(n.kind)].push(n);
    for (const lane of perLane) lane.sort(byTimeThenId);
    const groupRows = Math.max(...perLane.map((l) => l.length));
    for (let lane = 0; lane < 4; lane++) {
      const list = perLane[lane];
      const offset = (groupRows - list.length) / 2;
      list.forEach((n, i) => slots.push({ node: n, lane, row: row + offset + i }));
    }
    row += groupRows + o.groupGap;
  }
  const rows = slots.length ? row - o.groupGap : 0;

  const labels = new Map<string, string>();
  // A lane is never narrower than its header, so headers stay apart even
  // when the lane has no nodes yet (before onset only candidates exist).
  const laneLabelW = LANE_TITLES.map((t) => (o.measureHead ?? o.measure)(t) + 8);
  for (const s of slots) {
    const text = shortEvidenceLabel(s.node, { compact: o.compact === true });
    labels.set(s.node.id, text);
    laneLabelW[s.lane] = Math.max(laneLabelW[s.lane], o.measure(text));
  }

  const laneX: number[] = [];
  let x = o.padding + o.nodeSize / 2;
  for (let lane = 0; lane < 4; lane++) {
    laneX.push(x);
    x += o.nodeSize + o.labelGap + laneLabelW[lane] + o.laneGap;
  }
  const width = x - o.laneGap + o.padding;

  const positions: Record<string, { x: number; y: number }> = {};
  const placed: Placed[] = [];
  for (const s of slots) {
    const y = o.padding + o.nodeSize / 2 + s.row * o.rowPitch;
    positions[s.node.id] = { x: laneX[s.lane], y };
    placed.push({ id: s.node.id, x: laneX[s.lane], y, lane: s.lane, label: labels.get(s.node.id)! });
  }
  const height = rows > 0 ? o.padding * 2 + o.nodeSize + (rows - 1) * o.rowPitch : 0;
  return { positions, placed, laneX, width, height, rows };
}

// Axis-aligned label boxes for overlap checks. The box spans node + label.
export function labelBoxes(
  layout: EvidenceLayout,
  measure: (text: string) => number,
  nodeSize = DEFAULTS.nodeSize,
  labelGap = DEFAULTS.labelGap,
  lineHeight = 14,
) {
  return layout.placed.map((p) => ({
    id: p.id,
    x0: p.x - nodeSize / 2,
    x1: p.x + nodeSize / 2 + labelGap + measure(p.label),
    y0: p.y - Math.max(nodeSize, lineHeight) / 2,
    y1: p.y + Math.max(nodeSize, lineHeight) / 2,
  }));
}

export function overlappingPairs<T extends { id: string; x0: number; x1: number; y0: number; y1: number }>(
  boxes: T[],
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      if (hit) out.push([a.id, b.id]);
    }
  }
  return out;
}
