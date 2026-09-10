import { describe, expect, it } from "vitest";
import { labelBoxes, laneOf, layoutEvidence, overlappingPairs, type LayoutNode, LANE_TITLES } from "./evidenceLayout";

// Mirrors the guided incident's end-state evidence graph (14 nodes).
const T = 1700000000000000000;
const NODES: LayoutNode[] = [
  { id: "cand:checkoutservice", kind: "root_cause_candidate", service: "checkoutservice", label: "#2 likely cause: checkoutservice", strength: 0.48, time_ns: T + 7e9 },
  { id: "cand:frontend", kind: "root_cause_candidate", service: "frontend", label: "#3 likely cause: frontend", strength: 0.46, time_ns: T + 7e9 },
  { id: "cand:recommendationservice", kind: "root_cause_candidate", service: "recommendationservice", label: "#1 likely cause: recommendationservice", strength: 0.86, time_ns: T + 5e9 },
  { id: "change:c-deploy-rec-1", kind: "change", service: "recommendationservice", label: "change on recommendationservice", strength: 1 },
  { id: "deg:checkoutservice", kind: "service_degradation", service: "checkoutservice", label: "checkoutservice degradation", strength: 1, time_ns: T + 7e9 },
  { id: "deg:frontend", kind: "service_degradation", service: "frontend", label: "frontend degradation", strength: 1, time_ns: T + 7e9 },
  { id: "deg:recommendationservice", kind: "service_degradation", service: "recommendationservice", label: "recommendationservice degradation", strength: 1, time_ns: T + 5e9 },
  { id: "log:l-rec-mem-1", kind: "log_pattern", service: "recommendationservice", label: "high-severity log on recommendationservice", strength: 0.33 },
  { id: "metric:1", kind: "metric_anomaly", service: "recommendationservice", label: "recommendationservice_latency anomaly (peak |z| 8.0)", strength: 1, time_ns: T + 5e9 },
  { id: "metric:2", kind: "metric_anomaly", service: "checkoutservice", label: "checkoutservice_latency anomaly (peak |z| 8.0)", strength: 1, time_ns: T + 7e9 },
  { id: "metric:3", kind: "metric_anomaly", service: "recommendationservice", label: "recommendationservice_mem anomaly (peak |z| 8.0)", strength: 1, time_ns: T + 5e9 },
  { id: "metric:4", kind: "metric_anomaly", service: "checkoutservice", label: "checkoutservice_error_rate anomaly (peak |z| 8.0)", strength: 1, time_ns: T + 7e9 },
  { id: "metric:5", kind: "metric_anomaly", service: "frontend", label: "frontend_latency anomaly (peak |z| 8.0)", strength: 1, time_ns: T + 7e9 },
  { id: "metric:6", kind: "metric_anomaly", service: "frontend", label: "frontend_error_rate anomaly (peak |z| 8.0)", strength: 1, time_ns: T + 7e9 },
];

// 6.5 px per character approximates 11px Inter.
const measure = (t: string) => t.length * 6.5;

describe("layoutEvidence", () => {
  it("assigns lanes by kind", () => {
    expect(laneOf("change")).toBe(0);
    expect(laneOf("log_pattern")).toBe(0);
    expect(laneOf("metric_anomaly")).toBe(1);
    expect(laneOf("service_degradation")).toBe(2);
    expect(laneOf("root_cause_candidate")).toBe(3);
  });

  it("orders groups by candidate rank and places every node", () => {
    const l = layoutEvidence(NODES, { measure });
    expect(Object.keys(l.positions)).toHaveLength(NODES.length);
    const y = (id: string) => l.positions[id].y;
    // #1 recommendationservice group is above #2 checkoutservice, above #3 frontend
    expect(y("deg:recommendationservice")).toBeLessThan(y("deg:checkoutservice"));
    expect(y("deg:checkoutservice")).toBeLessThan(y("deg:frontend"));
    // a degradation sits vertically centred on its own anomalies
    const recAnoms = [y("metric:1"), y("metric:3")];
    expect(y("deg:recommendationservice")).toBeCloseTo((recAnoms[0] + recAnoms[1]) / 2, 5);
  });

  it("puts lanes strictly left to right with room for the widest label", () => {
    const l = layoutEvidence(NODES, { measure });
    expect(l.laneX[0]).toBeLessThan(l.laneX[1]);
    expect(l.laneX[1]).toBeLessThan(l.laneX[2]);
    expect(l.laneX[2]).toBeLessThan(l.laneX[3]);
    // lane 0 holds "error log: recommendationservice" (32 chars) — the next lane must clear it
    expect(l.laneX[1] - l.laneX[0]).toBeGreaterThan(measure("error log: recommendationservice"));
  });

  it("produces no overlapping label boxes", () => {
    const l = layoutEvidence(NODES, { measure });
    expect(overlappingPairs(labelBoxes(l, measure))).toEqual([]);
  });

  it("is stable: adding a node in one group leaves other groups' rows alone", () => {
    const before = layoutEvidence(NODES, { measure });
    const extra: LayoutNode = {
      id: "metric:7",
      kind: "metric_anomaly",
      service: "frontend",
      label: "frontend_cpu anomaly (peak |z| 4.0)",
      strength: 0.5,
      time_ns: T + 8e9,
    };
    const after = layoutEvidence([...NODES, extra], { measure });
    // frontend is the last group, so everything above it keeps its y
    for (const id of ["deg:recommendationservice", "metric:1", "cand:checkoutservice", "metric:4"]) {
      expect(after.positions[id].y).toBe(before.positions[id].y);
    }
    expect(overlappingPairs(labelBoxes(after, measure))).toEqual([]);
  });

  it("handles an empty graph", () => {
    const l = layoutEvidence([], { measure });
    expect(l.rows).toBe(0);
    expect(l.height).toBe(0);
    expect(l.placed).toEqual([]);
  });
});

describe("lane headers", () => {
  it("keeps lanes at least a header's width apart even when a lane is empty", () => {
    // Before onset only ranked candidates exist: lanes 0-2 have no labels.
    const onlyCandidates = NODES.filter((n) => n.kind === "root_cause_candidate");
    const l = layoutEvidence(onlyCandidates, { measure });
    const titles = LANE_TITLES;
    for (let i = 0; i < 3; i++) {
      expect(l.laneX[i + 1] - l.laneX[i]).toBeGreaterThanOrEqual(measure(titles[i]) + 16);
    }
  });
});

describe("compact layout", () => {
  const titles = LANE_TITLES;

  it("fits the guided fixture in a narrow column without overlaps", () => {
    const l = layoutEvidence(NODES, { measure, compact: true });
    // 693 at 6.5 px/char (about 600 px in real 11px Inter); full labels need 865.
    // Lane pitch is floored at the header width; the plain-words headers
    // ("2 · numbers went strange") set it, not the node labels. 6.5px/char here
    // is ~15% wider than 11px Inter in the browser.
    expect(l.width).toBeLessThanOrEqual(830);
    expect(layoutEvidence(NODES, { measure }).width - l.width).toBeGreaterThanOrEqual(100);
    expect(overlappingPairs(labelBoxes(l, measure))).toEqual([]);
    for (let i = 0; i < 3; i++) {
      expect(l.laneX[i + 1] - l.laneX[i]).toBeGreaterThanOrEqual(measure(titles[i]) + 16);
    }
    // compact labels are what got placed
    const byId = new Map(l.placed.map((p) => [p.id, p.label]));
    expect(byId.get("change:c-deploy-rec-1")).toBe("deploy");
    expect(byId.get("log:l-rec-mem-1")).toBe("error log");
    expect(byId.get("cand:recommendationservice")).toBe("candidate #1");
    expect(byId.get("metric:1")).toBe("latency");
  });

  it("keeps a condensed RE2-OB-shaped graph free of overlaps", () => {
    const nodes: LayoutNode[] = [];
    const candidates = ["currencyservice", "recommendationservice", "productcatalogservice"];
    candidates.forEach((svc, r) => {
      nodes.push({ id: `cand:${svc}`, kind: "root_cause_candidate", service: svc, label: `#${r + 1} likely cause: ${svc}`, strength: 0.4 - r * 0.02, time_ns: T + 1e9 });
      nodes.push({ id: `deg:${svc}`, kind: "service_degradation", service: svc, label: `${svc} degradation`, strength: 1, time_ns: T + 1e9 });
      ["cpu", "mem", "latency-50", "latency-90"].forEach((m, i) => {
        nodes.push({ id: `agg:${svc}:${m}`, kind: "metric_anomaly", service: svc, label: `${svc}_${m} anomaly (peak |z| 8.0)`, strength: 1, time_ns: T + (2 + i) * 1e9, count: 40 - i });
      });
      nodes.push({ id: `agg:${svc}:+more`, kind: "metric_anomaly", service: svc, label: `${svc} further anomalies`, strength: 0.9, time_ns: T + 9e9, count: 24, summary: "+24 more across 1 metric" });
    });
    const others = ["adservice", "cartservice", "checkoutservice", "emailservice", "frontend", "frontend-external", "paymentservice", "redis", "shippingservice"];
    for (const svc of others) {
      nodes.push({ id: `deg:${svc}`, kind: "service_degradation", service: svc, label: `${svc} degradation`, strength: 1, time_ns: T + 3e9 });
      nodes.push({ id: `agg:${svc}:all`, kind: "metric_anomaly", service: svc, label: `${svc} anomalies`, strength: 1, time_ns: T + 3e9, count: 141, summary: "141 anomalies across 8 metrics · peak z 8.0" });
    }
    const l = layoutEvidence(nodes, { measure, compact: true });
    expect(l.placed).toHaveLength(nodes.length);
    expect(overlappingPairs(labelBoxes(l, measure))).toEqual([]);
    // candidates come first, in rank order
    const y = (id: string) => l.positions[id].y;
    expect(y("deg:currencyservice")).toBeLessThan(y("deg:recommendationservice"));
    expect(y("deg:productcatalogservice")).toBeLessThan(y("deg:adservice"));
  });
});

describe("explicit order", () => {
  it("lays groups out in the given order and appends unknown services", () => {
    const l = layoutEvidence(NODES, { measure, order: ["frontend", "recommendationservice"] });
    const y = (id: string) => l.positions[id].y;
    expect(y("deg:frontend")).toBeLessThan(y("deg:recommendationservice"));
    expect(y("deg:recommendationservice")).toBeLessThan(y("deg:checkoutservice"));
    expect(overlappingPairs(labelBoxes(l, measure))).toEqual([]);
  });
});
