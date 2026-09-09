import { describe, expect, it } from "vitest";
import { condenseEvidence } from "./evidenceCondense";
import { shortEvidenceLabel } from "./labels";
import type { EvidenceGraphEdge, EvidenceGraphNode } from "../types/protocol";

const T = 1700000000000000000;
const S = 1e9;

function anomaly(service: string, metric: string, i: number, z = 8): EvidenceGraphNode {
  return {
    id: `metric:${service}:${metric}:${i}`,
    kind: "metric_anomaly",
    label: `${service}_${metric} anomaly (peak |z| ${z.toFixed(1)})`,
    service,
    time_ns: T + (10 + i) * S,
    strength: z / 8,
    source_refs: [],
  };
}
function deg(service: string): EvidenceGraphNode {
  return {
    id: `deg:${service}`,
    kind: "service_degradation",
    label: `${service} degradation`,
    service,
    time_ns: T + 10 * S,
    strength: 1,
    source_refs: [],
  };
}
function cand(service: string, rank: number): EvidenceGraphNode {
  return {
    id: `cand:${service}`,
    kind: "root_cause_candidate",
    label: `#${rank} likely cause: ${service}`,
    service,
    time_ns: T + 10 * S,
    strength: 0.5,
    source_refs: [],
  };
}
const edge = (from: string, to: string, kind = "contributes_to"): EvidenceGraphEdge => ({
  id: `${from}->${to}`,
  from,
  to,
  kind,
  label: kind,
});

describe("condenseEvidence", () => {
  it("leaves small graphs alone", () => {
    const nodes = [deg("a"), cand("a", 1), anomaly("a", "cpu", 0), anomaly("a", "mem", 1)];
    const edges = [edge(nodes[2].id, "deg:a"), edge("deg:a", "cand:a")];
    const c = condenseEvidence(nodes, edges);
    expect(c.condensed).toBe(false);
    expect(c.nodes).toBe(nodes);
    expect(c.edges).toBe(edges);
  });

  it("collapses per metric for candidates and to one row for other services", () => {
    const nodes: EvidenceGraphNode[] = [deg("a"), cand("a", 1), deg("b")];
    const edges: EvidenceGraphEdge[] = [edge("deg:a", "cand:a"), edge("deg:a", "deg:b", "propagates_to")];
    // candidate a: 5 metrics x 10 anomalies each; service b: 3 metrics x 10
    for (const m of ["cpu", "mem", "latency-50", "latency-90", "workload"]) {
      for (let i = 0; i < 10; i++) {
        const n = anomaly("a", m, i, m === "cpu" ? 8 : 5);
        nodes.push(n);
        edges.push(edge(n.id, "deg:a"));
      }
    }
    for (const m of ["cpu", "mem", "workload"]) {
      for (let i = 0; i < 10; i++) {
        const n = anomaly("b", m, i, 6);
        nodes.push(n);
        edges.push(edge(n.id, "deg:b"));
      }
    }
    const c = condenseEvidence(nodes, edges, { maxPerService: 4 });
    expect(c.condensed).toBe(true);
    const metricNodes = c.nodes.filter((n) => n.kind === "metric_anomaly");
    const a = metricNodes.filter((n) => n.service === "a");
    const b = metricNodes.filter((n) => n.service === "b");
    // 4 kept + 1 "+more" for the candidate, 1 summary for the other service
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(1);
    // strongest metric first, labelled with its count
    expect(shortEvidenceLabel(a[0])).toBe("cpu spike (z 8.0) ×10");
    expect(a[0].time_ns).toBe(T + 10 * S); // earliest member
    expect(shortEvidenceLabel(a[4])).toBe("+10 more across 1 metric");
    expect(shortEvidenceLabel(b[0])).toBe("30 anomalies across 3 metrics · peak z 6.0");
    // degradations and candidates pass through
    expect(
      c.nodes
        .filter((n) => n.kind !== "metric_anomaly")
        .map((n) => n.id)
        .sort(),
    ).toEqual(["cand:a", "deg:a", "deg:b"]);
    // edges re-targeted and de-duplicated: 5 (a metrics -> deg:a) + 1 (b) + 2 originals
    expect(c.edges).toHaveLength(8);
    expect(
      c.edges.every(
        (e) => c.nodes.some((n) => n.id === e.from) && c.nodes.some((n) => n.id === e.to),
      ),
    ).toBe(true);
    // ids are unique
    expect(new Set(c.nodes.map((n) => n.id)).size).toBe(c.nodes.length);
    expect(new Set(c.edges.map((e) => e.id)).size).toBe(c.edges.length);
  });
});
