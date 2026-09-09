// Stable service-group order for the evidence lanes.
//
// The server's rank numbers flip between frames when scores tie (pre-onset
// every candidate sits at the same floor), and a ranking that wobbles by a
// hundredth should not shuffle rows. So: candidates first by strength, then
// the rest by first appearance, then name, but an existing order is kept
// unless two neighbours are out of order by more than `hysteresis`.

import type { LayoutNode } from "./evidenceLayout";

export type OrderOptions = { hysteresis?: number };

type Facts = {
  strength: Map<string, number>; // candidate strength (the score), when ranked
  firstTime: Map<string, number>;
};

function gather(nodes: LayoutNode[]): { all: Set<string>; facts: Facts } {
  const all = new Set<string>();
  const strength = new Map<string, number>();
  const firstTime = new Map<string, number>();
  for (const n of nodes) {
    if (!n.service) continue;
    all.add(n.service);
    if (n.kind === "root_cause_candidate") {
      strength.set(n.service, Math.max(strength.get(n.service) ?? Number.NEGATIVE_INFINITY, n.strength));
    }
    if (n.time_ns != null) {
      firstTime.set(n.service, Math.min(firstTime.get(n.service) ?? Number.POSITIVE_INFINITY, n.time_ns));
    }
  }
  return { all, facts: { strength, firstTime } };
}

// Natural order with no memory: strongest candidate first, then unranked
// services by first appearance, then name.
function compare(a: string, b: string, f: Facts): number {
  const ca = f.strength.has(a);
  const cb = f.strength.has(b);
  if (ca !== cb) return ca ? -1 : 1;
  if (ca && cb) {
    const d = (f.strength.get(b) ?? 0) - (f.strength.get(a) ?? 0);
    if (d !== 0) return d;
  }
  const ta = f.firstTime.get(a) ?? Number.POSITIVE_INFINITY;
  const tb = f.firstTime.get(b) ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.localeCompare(b);
}

// Should `b`, currently after `a`, move in front of it? Only for a material
// reason: a candidate beating a non-candidate, a strength gap above the
// hysteresis, or (for unranked services) an earlier first appearance.
function shouldSwap(a: string, b: string, f: Facts, hysteresis: number): boolean {
  const ca = f.strength.has(a);
  const cb = f.strength.has(b);
  if (ca !== cb) return cb;
  if (ca && cb) return (f.strength.get(b) ?? 0) - (f.strength.get(a) ?? 0) > hysteresis;
  const ta = f.firstTime.get(a) ?? Number.POSITIVE_INFINITY;
  const tb = f.firstTime.get(b) ?? Number.POSITIVE_INFINITY;
  return tb < ta;
}

export function stableServiceOrder(
  prev: string[],
  nodes: LayoutNode[],
  opts: OrderOptions = {},
): string[] {
  const hysteresis = opts.hysteresis ?? 0.03;
  const { all, facts } = gather(nodes);
  if (all.size === 0) return [];
  if (prev.length === 0) return [...all].sort((a, b) => compare(a, b, facts));

  // Keep what survives, in its old order; newcomers go where the natural
  // order puts them relative to the survivors.
  const order = prev.filter((s) => all.has(s));
  const known = new Set(order);
  const newcomers = [...all].filter((s) => !known.has(s)).sort((a, b) => compare(a, b, facts));
  for (const s of newcomers) {
    let i = order.length;
    for (let k = 0; k < order.length; k++) {
      if (compare(s, order[k], facts) < 0) {
        i = k;
        break;
      }
    }
    order.splice(i, 0, s);
  }

  // Bubble only the material disorders (bounded passes; n is tiny).
  for (let pass = 0; pass < order.length; pass++) {
    let swapped = false;
    for (let i = 0; i + 1 < order.length; i++) {
      if (shouldSwap(order[i], order[i + 1], facts, hysteresis)) {
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return order;
}
