// The verdict in words. A sentence built from the score components that
// actually carried the ranking, so a reader who has never heard of RCA can
// see *why* a service is suspected. Claim discipline: "most likely culprit",
// never "the cause".

import type { RootCauseCandidate } from "../types/protocol";

export const CLAUSES: Record<string, string> = {
  change_proximity: "it got a new version just before things went wrong",
  temporal_precedence: "it went wrong before the services that depend on it",
  anomaly_strength: "its own numbers strayed far from normal",
  downstream_impact: "the services that depend on it slowed down afterwards",
  topology_consistency: "the pattern of slow services matches its position in the chain",
  failed_trace_coverage: "most failed requests passed through it",
  critical_path_contribution: "it sits on the slowest part of the request path",
  log_evidence: "its logs show errors",
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
    return `${c.service} is ranked first, but the evidence for it is weak.`;
  }
  const contradiction = c.components.find((k) => k.name === "contradiction_penalty");
  let sentence = `${c.service} is the most likely culprit: ${joinClauses(positive)}.`;
  if (contradiction && contradiction.contribution < -EPS) {
    sentence += " Though some evidence points the other way.";
  }
  return sentence;
}

// Score band in words: the number stays alongside, the word is what a
// newcomer reads.
export function evidenceWord(score: number): "strong" | "some" | "weak" | "none" {
  if (score >= 0.6) return "strong";
  if (score >= 0.3) return "some";
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
