// Layout for the operator DAG in the Runtime tab. Pure: takes the inspector's
// operator list, returns ranked positions. The DAG is small (six real nodes
// plus two ghosts for the demo pipeline), so a fixed-rank layered layout is
// enough and deterministic, which the label-overlap sweep relies on.

export type DagNodeInput = {
  stable_id: string;
  operator_type: string;
  upstream_ids?: string[];
  downstream_ids?: string[];
};

export type DagNode = {
  id: string;
  type: string;
  // Ghost nodes are ids referenced by an edge that carry no OperatorNode.
  ghost: null | "source" | "sink";
};

export type DagEdge = { from: string; to: string };

export type OperatorDag = { nodes: DagNode[]; edges: DagEdge[] };

export function buildOperatorDag(ops: DagNodeInput[]): OperatorDag {
  const known = new Set(ops.map((o) => o.stable_id));
  const nodes: DagNode[] = ops.map((o) => ({ id: o.stable_id, type: o.operator_type, ghost: null }));
  const edgeKeys = new Set<string>();
  const edges: DagEdge[] = [];
  const ghosts = new Map<string, "source" | "sink">();
  const addEdge = (from: string, to: string) => {
    const key = `${from}>${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to });
  };
  for (const o of ops) {
    for (const d of o.downstream_ids ?? []) {
      addEdge(o.stable_id, d);
      if (!known.has(d)) ghosts.set(d, "sink");
    }
    for (const u of o.upstream_ids ?? []) {
      addEdge(u, o.stable_id);
      if (!known.has(u)) ghosts.set(u, ghosts.get(u) === "sink" ? "sink" : "source");
    }
  }
  for (const [id, ghost] of ghosts) {
    nodes.push({ id, type: humanType(id), ghost });
  }
  return { nodes, edges };
}

function humanType(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export type DagLayoutOptions = {
  direction?: "vertical" | "horizontal";
  // Distance between ranks (rows when vertical).
  rankPitch?: number;
  // Distance between siblings inside one rank.
  siblingPitch?: number;
  padding?: number;
};

export type DagPlaced = { id: string; x: number; y: number; rank: number };
export type DagLayout = { placed: DagPlaced[]; width: number; height: number; ranks: number };

// Rank = longest path from a real source. Ghost sources sit one rank above
// their downstream node so change_source lands beside the window rank, not
// at the top; ghost sinks sit one rank below their upstream node.
export function rankOperatorDag(dag: OperatorDag): Map<string, number> {
  const rank = new Map<string, number>();
  const real = dag.nodes.filter((n) => n.ghost == null);
  const realIds = new Set(real.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of dag.edges) {
    if (!realIds.has(e.from) || !realIds.has(e.to)) continue;
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const longest = (id: string): number => {
    const m = memo.get(id);
    if (m != null) return m;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const ups = incoming.get(id) ?? [];
    const r = ups.length === 0 ? 0 : 1 + Math.max(...ups.map(longest));
    visiting.delete(id);
    memo.set(id, r);
    return r;
  };
  for (const n of real) rank.set(n.id, longest(n.id));
  for (const n of dag.nodes) {
    if (n.ghost == null) continue;
    if (n.ghost === "source") {
      const downs = dag.edges.filter((e) => e.from === n.id).map((e) => rank.get(e.to) ?? 1);
      rank.set(n.id, Math.max(0, (downs.length ? Math.min(...downs) : 1) - 1));
    } else {
      const ups = dag.edges.filter((e) => e.to === n.id).map((e) => rank.get(e.from) ?? 0);
      rank.set(n.id, (ups.length ? Math.max(...ups) : 0) + 1);
    }
  }
  return rank;
}

export function layoutOperatorDag(dag: OperatorDag, opts: DagLayoutOptions = {}): DagLayout {
  const direction = opts.direction ?? "vertical";
  const rankPitch = opts.rankPitch ?? 62;
  const siblingPitch = opts.siblingPitch ?? 104;
  const padding = opts.padding ?? 24;
  const rank = rankOperatorDag(dag);
  const byRank = new Map<number, string[]>();
  for (const n of dag.nodes) {
    const r = rank.get(n.id) ?? 0;
    byRank.set(r, [...(byRank.get(r) ?? []), n.id]);
  }
  const ranks = Array.from(byRank.keys()).sort((a, b) => a - b);
  // One barycenter pass: order each rank by the mean index of its upstream
  // nodes in the previous rank, ghosts last within a tie.
  const index = new Map<string, number>();
  for (const r of ranks) {
    const ids = byRank.get(r)!;
    const scored = ids.map((id) => {
      const ups = dag.edges.filter((e) => e.to === id).map((e) => index.get(e.from));
      const known = ups.filter((v): v is number => v != null);
      const bary = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
      const ghost = dag.nodes.find((n) => n.id === id)?.ghost != null ? 1 : 0;
      return { id, bary, ghost };
    });
    scored.sort((a, b) => a.bary - b.bary || a.ghost - b.ghost || a.id.localeCompare(b.id));
    scored.forEach((s, i) => index.set(s.id, i));
    byRank.set(r, scored.map((s) => s.id));
  }
  const widest = Math.max(1, ...ranks.map((r) => byRank.get(r)!.length));
  const across = (widest - 1) * siblingPitch;
  const along = (ranks.length - 1) * rankPitch;
  const placed: DagPlaced[] = [];
  for (const r of ranks) {
    const ids = byRank.get(r)!;
    const span = (ids.length - 1) * siblingPitch;
    ids.forEach((id, i) => {
      const a = padding + (across - span) / 2 + i * siblingPitch;
      const b = padding + r * rankPitch;
      placed.push(direction === "vertical" ? { id, x: a, y: b, rank: r } : { id, x: b, y: a, rank: r });
    });
  }
  const w = across + padding * 2;
  const h = along + padding * 2;
  return direction === "vertical"
    ? { placed, width: w, height: h, ranks: ranks.length }
    : { placed, width: h, height: w, ranks: ranks.length };
}
