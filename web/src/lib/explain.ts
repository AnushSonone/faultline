// The verdict in words. One sentence built from the score components that
// actually carried the ranking, so a reader can see which features put a
// service on top. Each clause names its feature. Claim discipline: "top
// root-cause candidate", never "the cause".

import type { RootCauseCandidate } from "../types/protocol";

export const CLAUSES: Record<string, string> = {
  change_proximity: "a deployment landed just before its onset (change proximity)",
  temporal_precedence: "its anomaly onset preceded its callers' (temporal precedence)",
  anomaly_strength: "its peak robust z-score is high (anomaly strength)",
  downstream_impact: "the other anomalous services are reachable from it (downstream impact)",
  topology_consistency: "its dependency paths explain the anomalous set (topology consistency)",
  failed_trace_coverage: "most failed traces pass through it (failed-trace coverage)",
  critical_path_contribution:
    "it carries the excess latency on the critical path (critical-path contribution)",
  log_evidence: "correlated error logs (log evidence)",
};

const EPS = 0.005;

function joinClauses(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function explainCandidate(
  c: RootCauseCandidate,
  opts: { maxClauses?: number } = {},
): string {
  const max = opts.maxClauses ?? 3;
  const positive = c.components
    .filter((k) => k.contribution > EPS && CLAUSES[k.name] != null)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, max)
    .map((k) => CLAUSES[k.name]);
  if (positive.length === 0) {
    return `${c.service} ranks first, but its evidence score is weak.`;
  }
  const contradiction = c.components.find((k) => k.name === "contradiction_penalty");
  let sentence = `${c.service} is the top root-cause candidate: ${joinClauses(positive)}.`;
  if (contradiction && contradiction.contribution < -EPS) {
    sentence += " A contradiction penalty applies: some of its impacted callers degraded first.";
  }
  return sentence;
}

export type ScoreBand = "strong" | "moderate" | "weak" | "none";

// Score band in words. The number is the primary label; the band is the
// tooltip and the colour cue.
export function scoreBand(score: number): ScoreBand {
  if (score >= 0.6) return "strong";
  if (score >= 0.3) return "moderate";
  if (score > 0) return "weak";
  return "none";
}

export function ordinal(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
