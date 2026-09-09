// Condense a raw evidence graph for display. Real incidents carry hundreds of
// metric-anomaly nodes per service (RE2-OB: ~1450 across 12 services); one
// row each would be a 40,000px canvas. Rules:
//   - anomalies collapse to one node per (service, metric) with the peak z,
//     the earliest time, and a count;
//   - a ranked candidate keeps its top `maxPerService` metric nodes plus one
//     "+k more" node;
//   - every other service keeps its degradation and one summary node for all
//     its anomalies;
//   - edges follow their members and are de-duplicated; degradations,
//     candidates, changes and logs pass through untouched.
// Small graphs (the guided incident) come out unchanged.

import type { EvidenceGraphEdge, EvidenceGraphNode } from "../types/protocol";
import { parseAnomaly } from "./labels";

export type CondensedNode = EvidenceGraphNode & {
  count?: number;
  summary?: string;
  members?: string[];
};

export type Condensed = { nodes: CondensedNode[]; edges: EvidenceGraphEdge[]; condensed: boolean };

export type CondenseOptions = { maxPerService?: number; threshold?: number };

type Agg = {
  service: string;
  metric: string;
  z: number;
  time: number | null;
  strength: number;
  members: string[];
  label: string;
};

function num(z: string): number {
  const n = Number(z);
  return Number.isFinite(n) ? n : 0;
}

function earliest(list: Agg[]): number | null {
  return list.reduce<number | null>(
    (t, a) => (a.time != null && (t == null || a.time < t) ? a.time : t),
    null,
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function condenseEvidence(
  nodes: EvidenceGraphNode[],
  edges: EvidenceGraphEdge[],
  opts: CondenseOptions = {},
): Condensed {
  const maxPerService = opts.maxPerService ?? 4;
  const threshold = opts.threshold ?? 24;
  const anomalies = nodes.filter((n) => n.kind === "metric_anomaly");
  if (anomalies.length <= threshold) return { nodes, edges, condensed: false };

  const candidates = new Set(
    nodes
      .filter((n) => n.kind === "root_cause_candidate" && n.service)
      .map((n) => n.service as string),
  );

  const aggs = new Map<string, Agg>();
  for (const n of anomalies) {
    const service = n.service ?? "";
    const parsed = parseAnomaly(n.label, n.service);
    const metric = parsed?.metric ?? n.label;
    const key = `${service} ${metric}`;
    const z = parsed ? num(parsed.z) : n.strength * 8;
    const cur = aggs.get(key);
    if (!cur) {
      aggs.set(key, {
        service,
        metric,
        z,
        time: n.time_ns ?? null,
        strength: n.strength,
        members: [n.id],
        label: n.label,
      });
    } else {
      cur.members.push(n.id);
      if (z > cur.z) {
        cur.z = z;
        cur.label = n.label;
      }
      cur.strength = Math.max(cur.strength, n.strength);
      if (n.time_ns != null && (cur.time == null || n.time_ns < cur.time)) cur.time = n.time_ns;
    }
  }

  const byService = new Map<string, Agg[]>();
  for (const a of aggs.values()) byService.set(a.service, [...(byService.get(a.service) ?? []), a]);

  const idMap = new Map<string, string>(); // member id -> displayed node id
  const out: CondensedNode[] = nodes.filter((n) => n.kind !== "metric_anomaly");

  for (const [service, list] of byService) {
    list.sort(
      (a, b) => b.z - a.z || b.strength - a.strength || a.metric.localeCompare(b.metric),
    );
    if (candidates.has(service)) {
      const keep = list.slice(0, maxPerService);
      const rest = list.slice(maxPerService);
      for (const a of keep) {
        const id = `agg:${service}:${a.metric}`;
        out.push({
          id,
          kind: "metric_anomaly",
          label: a.label,
          service,
          time_ns: a.time,
          strength: a.strength,
          source_refs: [],
          count: a.members.length,
          members: a.members,
        });
        for (const m of a.members) idMap.set(m, id);
      }
      if (rest.length > 0) {
        const id = `agg:${service}:+more`;
        const members = rest.flatMap((a) => a.members);
        out.push({
          id,
          kind: "metric_anomaly",
          label: `${service} further anomalies`,
          service,
          time_ns: earliest(rest),
          strength: Math.max(...rest.map((a) => a.strength)),
          source_refs: [],
          count: members.length,
          members,
          summary: `+${members.length} more across ${plural(rest.length, "metric")}`,
        });
        for (const m of members) idMap.set(m, id);
      }
    } else {
      const id = `agg:${service}:all`;
      const members = list.flatMap((a) => a.members);
      const peak = Math.max(...list.map((a) => a.z));
      out.push({
        id,
        kind: "metric_anomaly",
        label: `${service} anomalies`,
        service,
        time_ns: earliest(list),
        strength: Math.max(...list.map((a) => a.strength)),
        source_refs: [],
        count: members.length,
        members,
        summary: `${plural(members.length, "anomaly").replace("anomalys", "anomalies")} across ${plural(list.length, "metric")} · peak z ${peak.toFixed(1)}`,
      });
      for (const m of members) idMap.set(m, id);
    }
  }

  const seen = new Set<string>();
  const outEdges: EvidenceGraphEdge[] = [];
  for (const e of edges) {
    const from = idMap.get(e.from) ?? e.from;
    const to = idMap.get(e.to) ?? e.to;
    if (from === to) continue;
    const key = `${from} ${to} ${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const remapped = idMap.has(e.from) || idMap.has(e.to);
    outEdges.push({ ...e, id: remapped ? `agg-edge:${key.replace(/ /g, ":")}` : e.id, from, to });
  }
  return { nodes: out, edges: outEdges, condensed: true };
}
