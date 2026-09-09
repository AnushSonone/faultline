import { describe, expect, it } from "vitest";
import { buildNarration } from "./narration";

const T = 1700000000000000000;
const S = 1e9;

const timeline = {
  projection_version: 1,
  cursor_event_time_ns: 0,
  events: [
    { event_id: "m1", event_time_ns: T, signal: "metric", service: "cartservice", summary: "cartservice_latency=40" },
    { event_id: "d1", event_time_ns: T + 5 * S, signal: "deployment", service: "recommendationservice", summary: "deployment deploy-rec-v2" },
    { event_id: "l1", event_time_ns: T + 5.5 * S, signal: "log", service: "recommendationservice", summary: "GC pause elevated after deploy" },
    { event_id: "l2", event_time_ns: T + 10 * S, signal: "log", service: "recommendationservice", summary: "memory pressure; cache miss storm" },
  ],
};
const evidenceGraph = {
  projection_version: 1,
  cursor_event_time_ns: 0,
  graph: {
    incident_id: "rec-mem-001",
    nodes: [
      { id: "change:1", kind: "change", label: "change on recommendationservice", service: "recommendationservice", strength: 1, source_refs: [] },
      { id: "metric:1", kind: "metric_anomaly", label: "recommendationservice_mem anomaly (peak |z| 8.0)", service: "recommendationservice", time_ns: T + 5 * S, strength: 1, source_refs: [] },
      { id: "deg:checkout", kind: "service_degradation", label: "checkoutservice degradation", service: "checkoutservice", time_ns: T + 7 * S, strength: 1, source_refs: [] },
      { id: "cand:rec", kind: "root_cause_candidate", label: "#1 likely cause: recommendationservice", service: "recommendationservice", time_ns: T + 5 * S, strength: 0.86, source_refs: [] },
    ],
    edges: [],
  },
};

describe("buildNarration", () => {
  it("cuts at the cursor and orders newest first", () => {
    const items = buildNarration({ timeline, evidenceGraph, cursorNs: T + 6 * S });
    expect(items.map((i) => i.text)).toEqual([
      "GC pause elevated after deploy",
      "#1 recommendationservice ranked",
      "recommendationservice mem spike (z 8.0)",
      "deployment deploy-rec-v2",
    ]);
  });
  it("includes everything with no cursor, honouring the limit", () => {
    const items = buildNarration({ timeline, evidenceGraph, cursorNs: null, limit: 3 });
    expect(items).toHaveLength(3);
    expect(items[0].text).toBe("memory pressure; cache miss storm");
    expect(items[1].text).toBe("checkoutservice degraded");
  });
  it("is empty before anything happened", () => {
    expect(buildNarration({ timeline, evidenceGraph, cursorNs: T + 1 * S })).toEqual([]);
    expect(buildNarration({ timeline: null, evidenceGraph: null, cursorNs: null })).toEqual([]);
  });
});

describe("log flood", () => {
  it("drops log lines when an incident carries more than a dozen of them", () => {
    const noisy = {
      ...timeline,
      events: [
        ...timeline.events,
        ...Array.from({ length: 20 }, (_, i) => ({
          event_id: `n${i}`,
          event_time_ns: T + (1 + i * 0.1) * S,
          signal: "log",
          service: "adservice",
          summary: "received ad request",
        })),
      ],
    };
    const items = buildNarration({ timeline: noisy, evidenceGraph, cursorNs: null, limit: 50 });
    expect(items.some((i) => i.kind === "log_pattern")).toBe(false);
    // deploys still narrate
    expect(items.some((i) => i.text === "deployment deploy-rec-v2")).toBe(true);
  });
});
