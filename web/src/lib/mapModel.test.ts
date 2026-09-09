import { describe, expect, it } from "vitest";
import { buildMapModel, heatAt, layoutMap, mapSignature } from "./mapModel";
import type { HeatmapCell } from "../types/protocol";

const T = 1700000000000000000;
const S = 1e9;
const cell = (service: string, sec: number, value: number): HeatmapCell => ({
  service,
  bucket_start_ns: T + sec * S,
  value,
  sample_count: 10,
});

describe("heatAt", () => {
  it("is zero at baseline and saturates at three times baseline", () => {
    const cells = [cell("a", 0, 40), cell("a", 1, 40), cell("a", 2, 40), cell("a", 5, 80), cell("a", 6, 120)];
    expect(heatAt(cells, T + 2 * S)).toBe(0);
    expect(heatAt(cells, T + 5 * S)).toBeCloseTo(0.5, 5);
    expect(heatAt(cells, T + 6 * S)).toBe(1);
    expect(heatAt(cells, T + 9 * S)).toBe(1); // holds the latest cell
    expect(heatAt(cells, null)).toBe(1); // no cursor: end state
  });
  it("ignores cells after the cursor", () => {
    const cells = [cell("a", 0, 40), cell("a", 5, 400)];
    expect(heatAt(cells, T + 1 * S)).toBe(0);
  });
});

describe("buildMapModel", () => {
  const topology = {
    projection_version: 1,
    cursor_event_time_ns: 0,
    graph: {
      nodes: [
        { service: "frontend", request_count: 48, error_count: 8 },
        { service: "checkoutservice", request_count: 45, error_count: 7 },
        { service: "recommendationservice", request_count: 45, error_count: 7 },
      ],
      edges: [
        { from: "frontend", to: "checkoutservice" },
        { from: "checkoutservice", to: "recommendationservice" },
      ],
    },
  };
  const heatmap = {
    projection_version: 1,
    cursor_event_time_ns: 0,
    bucket_width_ns: S,
    cells: [
      ...[0, 1, 2, 3, 4].map((s) => cell("recommendationservice", s, 40)),
      cell("recommendationservice", 5, 200),
      ...[0, 1, 2, 3, 4, 5, 6].map((s) => cell("cartservice", s, 40)),
    ],
  };
  const rootCauses = {
    projection_version: 1,
    cursor_event_time_ns: 0,
    language: "",
    candidates: [
      { rank: 1, service: "recommendationservice", score: 0.86, components: [], features: { peak_abs_z: 8, impacted_anomalous: [], preceding_impacted: [] } },
      { rank: 4, service: "cartservice", score: -0.1, components: [], features: { peak_abs_z: 0, impacted_anomalous: [], preceding_impacted: [] } },
    ],
    evidence: [],
  };
  const correlations = [
    {
      change_id: "c1",
      service: "recommendationservice",
      change_type: "deploy",
      deployed_at_ns: T + 5 * S,
      associated_anomalous_windows: 1,
      match_confidence: "high",
      evidence_refs: [],
      language: "",
    },
  ];

  it("unions topology, heatmap and candidates, marking metrics-only services", () => {
    const m = buildMapModel({ topology, heatmap, rootCauses, correlations, cursorNs: null });
    expect(m.nodes.map((n) => n.id)).toEqual([
      "cartservice",
      "checkoutservice",
      "frontend",
      "recommendationservice",
    ]);
    const cart = m.nodes.find((n) => n.id === "cartservice")!;
    expect(cart.observed).toBe(false);
    expect(cart.rank).toBe(4);
    expect(m.roots).toEqual(["frontend"]);
  });

  it("applies cursor-dependent heat and deploy badges", () => {
    const early = buildMapModel({ topology, heatmap, rootCauses, correlations, cursorNs: T + 2 * S });
    const rec = early.nodes.find((n) => n.id === "recommendationservice")!;
    expect(rec.heat).toBe(0);
    expect(rec.deployed).toBe(false);
    // error rate from topology still marks it hot (7/45 > 5%)
    expect(rec.hot).toBe(true);

    const late = buildMapModel({ topology, heatmap, rootCauses, correlations, cursorNs: T + 5 * S });
    const recLate = late.nodes.find((n) => n.id === "recommendationservice")!;
    expect(recLate.heat).toBe(1);
    expect(recLate.deployed).toBe(true);
    expect(recLate.rank).toBe(1);
  });

  it("marks an edge propagating only when both ends are hot", () => {
    const m = buildMapModel({ topology, heatmap, rootCauses, correlations, cursorNs: null });
    // all three observed services have > 5% errors in this topology
    expect(m.edges.every((e) => e.propagating)).toBe(true);
    const calm = {
      ...topology,
      graph: {
        ...topology.graph,
        nodes: topology.graph.nodes.map((n) => ({ ...n, error_count: 0 })),
      },
    };
    const m2 = buildMapModel({ topology: calm, heatmap, rootCauses, correlations, cursorNs: T + 1 * S });
    expect(m2.edges.every((e) => !e.propagating)).toBe(true);
  });

  it("signature changes with structure, not with heat", () => {
    const a = buildMapModel({ topology, heatmap, rootCauses, correlations, cursorNs: T });
    const b = buildMapModel({ topology, heatmap, rootCauses, correlations, cursorNs: T + 9 * S });
    expect(mapSignature(a)).toBe(mapSignature(b));
    const c = buildMapModel({ topology: null, heatmap, rootCauses, correlations, cursorNs: T });
    expect(mapSignature(c)).not.toBe(mapSignature(a));
  });
});

describe("layoutMap", () => {
  it("stacks callers above callees and parks metrics-only nodes underneath", () => {
    const model = {
      roots: ["frontend"],
      nodes: ["cartservice", "checkoutservice", "frontend", "recommendationservice"].map((id) => ({
        id,
        observed: id !== "cartservice",
        requestCount: 1,
        errorRate: 0,
        heat: 0,
        hot: false,
        rank: null,
        score: null,
        deployed: false,
      })),
      edges: [
        { id: "a", source: "frontend", target: "checkoutservice", propagating: false },
        { id: "b", source: "checkoutservice", target: "recommendationservice", propagating: false },
        { id: "c", source: "frontend", target: "recommendationservice", propagating: false },
      ],
    };
    const p = layoutMap(model, { rowGap: 100, colGap: 150, orphanGap: 50 });
    expect(p.frontend.x).toBe(0);
    expect(p.checkoutservice.x).toBe(150);
    // longest path wins: frontend -> checkout -> recommendation puts it at depth 2
    expect(p.recommendationservice.x).toBe(300);
    // single node per depth is centred on the row axis
    expect(p.frontend.y).toBe(0);
    // metrics-only service sits under the graph, centred horizontally
    expect(p.cartservice.y).toBe(50);
    expect(p.cartservice.x).toBe(150);
  });
  it("spreads siblings and survives a cycle", () => {
    const mk = (id: string, observed = true) => ({ id, observed, requestCount: 1, errorRate: 0, heat: 0, hot: false, rank: null, score: null, deployed: false });
    const model = {
      roots: ["a"],
      nodes: [mk("a"), mk("b"), mk("c"), mk("d")],
      edges: [
        { id: "1", source: "a", target: "b", propagating: false },
        { id: "2", source: "a", target: "c", propagating: false },
        { id: "3", source: "c", target: "d", propagating: false },
        { id: "4", source: "d", target: "c", propagating: false },
      ],
    };
    const p = layoutMap(model, { rowGap: 100, colGap: 150 });
    expect(p.b.x).toBe(150);
    expect(p.c.x).toBe(150);
    expect(Math.abs(p.b.y - p.c.y)).toBe(100);
    expect(p.d.x).toBeGreaterThan(p.c.x);
  });
});

describe("evidence-driven heat", () => {
  it("marks a service hot from evidence-graph anomalies even when latency is flat", () => {
    const flatHeatmap = {
      projection_version: 1,
      cursor_event_time_ns: 0,
      bucket_width_ns: S,
      cells: [0, 1, 2, 3, 4, 5, 6].map((s) => cell("emailservice", s, 40)),
    };
    const topology = {
      projection_version: 1,
      cursor_event_time_ns: 0,
      graph: { nodes: [{ service: "emailservice", request_count: 10, error_count: 0 }], edges: [] },
    };
    const evidenceGraph = {
      projection_version: 1,
      cursor_event_time_ns: 0,
      graph: {
        incident_id: "x",
        nodes: [
          { id: "m1", kind: "metric_anomaly", label: "emailservice_cpu anomaly (peak |z| 8.0)", service: "emailservice", time_ns: T + 4 * S, strength: 0.9, source_refs: [] },
        ],
        edges: [],
      },
    };
    const before = buildMapModel({ topology, heatmap: flatHeatmap, rootCauses: null, correlations: [], evidenceGraph, cursorNs: T + 2 * S });
    expect(before.nodes[0].heat).toBe(0);
    expect(before.nodes[0].hot).toBe(false);
    const after = buildMapModel({ topology, heatmap: flatHeatmap, rootCauses: null, correlations: [], evidenceGraph, cursorNs: T + 5 * S });
    expect(after.nodes[0].heat).toBeCloseTo(0.9, 5);
    expect(after.nodes[0].hot).toBe(true);
  });
});

describe("layoutMap vertical", () => {
  const mk = (id: string, observed = true) => ({ id, observed, requestCount: 1, errorRate: 0, heat: 0, hot: false, rank: null, score: null, deployed: false });
  it("stacks depths top to bottom and parks metrics-only nodes underneath", () => {
    const model = {
      roots: ["frontend"],
      nodes: [mk("cartservice", false), mk("checkoutservice"), mk("frontend"), mk("recommendationservice")],
      edges: [
        { id: "a", source: "frontend", target: "checkoutservice", propagating: false },
        { id: "b", source: "checkoutservice", target: "recommendationservice", propagating: false },
      ],
    };
    const p = layoutMap(model, { rowGap: 100, colGap: 150, orphanGap: 50, depthPitch: 100, direction: "vertical" });
    expect(p.frontend.y).toBe(0);
    expect(p.checkoutservice.y).toBe(100);
    expect(p.recommendationservice.y).toBe(200);
    // single node per depth is centred on x
    expect(p.frontend.x).toBe(0);
    // orphan row sits a clear label's worth under the deepest level
    expect(p.cartservice.y).toBe(200 + 50 + 50);
    expect(p.cartservice.x).toBe(0);
  });
  it("spreads siblings at the wide pitch and survives a cycle", () => {
    const model = {
      roots: ["a"],
      nodes: [mk("a"), mk("b"), mk("c"), mk("d")],
      edges: [
        { id: "1", source: "a", target: "b", propagating: false },
        { id: "2", source: "a", target: "c", propagating: false },
        { id: "3", source: "c", target: "d", propagating: false },
        { id: "4", source: "d", target: "c", propagating: false },
      ],
    };
    const p = layoutMap(model, { rowGap: 100, colGap: 150, depthPitch: 100, direction: "vertical" });
    expect(p.b.y).toBe(100);
    expect(p.c.y).toBe(100);
    // siblings use colGap (label room), not rowGap
    expect(Math.abs(p.b.x - p.c.x)).toBe(150);
    expect(p.d.y).toBeGreaterThan(p.c.y);
  });
  it("keeps sibling labels apart at the default pitches", () => {
    const model = {
      roots: ["a"],
      nodes: [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")],
      edges: ["b", "c", "d", "e"].map((t) => ({ id: t, source: "a", target: t, propagating: false })),
    };
    const p = layoutMap(model, { direction: "vertical" });
    const xs = ["b", "c", "d", "e"].map((id) => p[id].x).sort((x, y) => x - y);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(150);
  });
});
