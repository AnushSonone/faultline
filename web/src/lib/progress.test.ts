import { describe, expect, it } from "vitest";
import { anomalyOnsetNs, checklistRows } from "./progress";
import type { EvidenceGraphPayload } from "../types/protocol";

const graph = (nodes: Array<{ kind: string; time_ns?: number | null }>): EvidenceGraphPayload =>
  ({
    projection_version: 1,
    cursor_event_time_ns: 0,
    graph: {
      nodes: nodes.map((n, i) => ({ id: `n${i}`, label: n.kind, ...n })),
      edges: [],
    },
  }) as unknown as EvidenceGraphPayload;

describe("anomalyOnsetNs", () => {
  it("takes the earliest anomaly or degradation time and ignores the rest", () => {
    expect(
      anomalyOnsetNs(
        graph([
          { kind: "change", time_ns: 1 },
          { kind: "metric_anomaly", time_ns: 7 },
          { kind: "service_degradation", time_ns: 5 },
          { kind: "root_cause_candidate", time_ns: 2 },
          { kind: "metric_anomaly", time_ns: null },
        ]),
      ),
    ).toBe(5);
    expect(anomalyOnsetNs(graph([{ kind: "change", time_ns: 1 }]))).toBeNull();
    expect(anomalyOnsetNs(null)).toBeNull();
  });
});

describe("checklistRows", () => {
  it("derives the six rows and locks ground truth until a full replay", () => {
    const rows = checklistRows({
      briefRead: false,
      visitedTabs: ["signals"],
      playedOnce: true,
      sawAnomaly: false,
      sawRanking: false,
      replayCompleted: false,
      groundTruthRevealed: false,
    });
    expect(rows.map((r) => [r.id, r.done])).toEqual([
      ["case", false],
      ["replay", true],
      ["graph", false],
      ["telemetry", true],
      ["ranking", false],
      ["truth", false],
    ]);
    expect(rows[5].locked).toBe(true);
    const done = checklistRows({
      briefRead: true,
      visitedTabs: ["case", "signals", "root-causes"],
      playedOnce: true,
      sawAnomaly: true,
      sawRanking: false,
      replayCompleted: true,
      groundTruthRevealed: true,
    });
    expect(done.every((r) => r.done)).toBe(true);
    expect(done[5].locked).toBe(false);
  });
});
