// Investigation progress helpers. The checklist in the rail ticks as the
// visitor does things; these are the pure parts.

import type { EvidenceGraphPayload } from "../types/protocol";

// The earliest time at which the evidence graph shows a service misbehaving:
// the minimum node time over metric anomalies and degradations. Null until
// the ranker has emitted one.
export function anomalyOnsetNs(graph: EvidenceGraphPayload | null): number | null {
  if (!graph) return null;
  let min: number | null = null;
  for (const n of graph.graph.nodes) {
    if (n.kind !== "metric_anomaly" && n.kind !== "service_degradation") continue;
    if (n.time_ns == null) continue;
    if (min == null || n.time_ns < min) min = n.time_ns;
  }
  return min;
}

export type CheckId = "case" | "replay" | "graph" | "telemetry" | "ranking" | "truth";

export type CheckRow = { id: CheckId; done: boolean; locked?: boolean };

export type ProgressInput = {
  briefRead: boolean;
  visitedTabs: string[];
  playedOnce: boolean;
  sawAnomaly: boolean;
  sawRanking: boolean;
  replayCompleted: boolean;
  groundTruthRevealed: boolean;
};

export function checklistRows(p: ProgressInput): CheckRow[] {
  return [
    { id: "case", done: p.briefRead || p.visitedTabs.includes("case") },
    { id: "replay", done: p.playedOnce },
    { id: "graph", done: p.sawAnomaly },
    { id: "telemetry", done: p.visitedTabs.includes("signals") },
    { id: "ranking", done: p.sawRanking || p.visitedTabs.includes("root-causes") },
    { id: "truth", done: p.groundTruthRevealed, locked: !p.replayCompleted },
  ];
}
