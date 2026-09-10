import type { RuntimeTabId, TabId, TourTarget } from "../state/investigation";

// One sentence under each drawer title. They describe the tool, not any
// particular incident.
export const SECTION_LEADS: Record<TabId, string> = {
  overview:
    "The dependency graph, the evidence graph and the ranking, all following the replay cursor.",
  "root-causes":
    "Every service is scored by a fixed linear formula over nine features; each row decomposes its score into value, weight and contribution.",
  signals:
    "The telemetry behind the ranking: p99 latency per service and window via DDSketch, and one sampled trace with its critical path.",
  case:
    "What was recorded, which request routes it covers, the injected signal, and the fault-injection label, which unlocks after one full replay.",
  runtime:
    "The streaming engine that computes the stage: operator DAG, watermarks, ingestion, query planner, scoring formula and checkpoint recovery.",
};

export const MAP_LEAD =
  "Services and their observed call edges, caller to callee; a node turns red when one of its metrics leaves its own baseline.";

export const EVIDENCE_LEAD =
  "Change events, metric anomalies, degradations and candidates, left to right, linked by the evidence the ranker used; faded nodes are ahead of the cursor.";

// The walkthrough: one spotlight per step, every section covered, one or two
// short sentences each. Steps with a `tab` open that dock tab first and
// spotlight the drawer. Step order is part of the e2e contract
// (briefing.spec.ts): step 2 is the map, step 5 the verdict.
export type WalkStep = {
  target: TourTarget | null;
  tab?: TabId;
  runtimeTab?: RuntimeTabId;
  // The step shows the ranking or its evidence: seek to the end once.
  needsEvidence?: boolean;
  title: string;
  text: string;
};

export const WALK_STEPS: WalkStep[] = [
  {
    target: null,
    title: "Faultline",
    text: "A streaming root-cause analysis engine. It replays an incident on an event-time clock, builds an evidence graph and ranks candidates. A ranking, never a proof.",
  },
  {
    target: "map",
    title: "Dependency graph",
    text: "Services and their observed call edges, caller to callee. A node turns red when a metric leaves its own baseline; the badge is the candidate rank.",
  },
  {
    target: "transport",
    title: "Replay transport",
    text: "Pick an incident, then Play streams its events in event-time order. Reset returns to the start; Advanced toggles projection mode and out-of-order arrival.",
  },
  {
    target: "track",
    title: "Event-time scrubber",
    text: "One time axis for every panel. Yellow bars are change events, dots are evidence as it lands. Drag to seek.",
  },
  {
    target: "verdict",
    needsEvidence: true,
    title: "Top root-cause candidate",
    text: "The highest-scoring candidate, its evidence score from 0 to 1, and the features that carried it. A ranking of hypotheses, not a proof.",
  },
  {
    target: "ranking",
    needsEvidence: true,
    title: "Candidate ranking",
    text: "All candidates by evidence score, re-ordered live as evidence lands. Click a row to link every panel to that service.",
  },
  {
    target: "feed",
    needsEvidence: true,
    title: "Evidence timeline",
    text: "Change events, anomalies, degradations and rank changes up to the cursor, newest first. Anomalies carry their peak robust z-score.",
  },
  {
    target: "evidence",
    needsEvidence: true,
    title: "Evidence graph",
    text: "Provenance of the ranking, left to right: change event, anomaly, degradation, candidate. Dashed red edges contradict; faded nodes are ahead of the cursor.",
  },
  {
    target: "tab-root-causes",
    tab: "root-causes",
    needsEvidence: true,
    title: "Ranking tab",
    text: "Per-candidate score decomposition: feature value, weight and contribution. Below it, change proximity joins deployments to anomaly onsets.",
  },
  {
    target: "tab-signals",
    tab: "signals",
    needsEvidence: true,
    title: "Telemetry tab",
    text: "The p99 latency heatmap per service and window, and one sampled trace as a waterfall with its critical path marked.",
  },
  {
    target: "tab-case",
    tab: "case",
    title: "Case file tab",
    text: "What was recorded, the request routes, and the injected signal. The fault-injection label unlocks after one full replay; the ranker never reads it.",
  },
  {
    target: "tab-runtime",
    tab: "runtime",
    runtimeTab: "pipeline",
    title: "Runtime tab",
    text: "The stream processor underneath: operator DAG, event-time watermarks, ingestion, the SQL planner, the scoring formula and checkpoint recovery.",
  },
  {
    target: "transport",
    title: "Run the replay",
    text: "Press Play and watch the deploy marker, the first anomaly, the propagation and the ranking settle. Then open Case file to compare with ground truth.",
  },
];
