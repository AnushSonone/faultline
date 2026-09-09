// "What just happened": a merged, time-ordered feed of the deploy/log events
// on the timeline and the evidence-graph nodes that carry a time, cut at the
// replay cursor. Derived from payloads only, so it works on every incident.

import type { EvidenceGraphPayload, TimelinePayload } from "../types/protocol";
import { shortEvidenceLabel } from "./labels";

export type NarrationItem = {
  id: string;
  timeNs: number;
  kind: string; // change | log_pattern | metric_anomaly | service_degradation | root_cause_candidate
  service: string | null;
  text: string;
};

export type NarrationInput = {
  timeline: TimelinePayload | null;
  evidenceGraph: EvidenceGraphPayload | null;
  cursorNs: number | null;
  limit?: number;
};

const TIMELINE_KINDS: Record<string, string> = {
  deployment: "change",
  configuration: "change",
  log: "log_pattern",
};

// Past this many log lines an incident's logs are a firehose (RE2-OB caps at
// 4000), and narrating them buries the deploys and anomalies.
export const MAX_NARRATED_LOGS = 12;

export function buildNarration(input: NarrationInput): NarrationItem[] {
  const { timeline, evidenceGraph, cursorNs, limit = 6 } = input;
  const items: NarrationItem[] = [];
  const events = timeline?.events ?? [];
  const logCount = events.reduce((n, e) => n + (e.signal === "log" ? 1 : 0), 0);
  for (const e of events) {
    const kind = TIMELINE_KINDS[e.signal];
    if (!kind) continue;
    if (kind === "log_pattern" && logCount > MAX_NARRATED_LOGS) continue;
    items.push({
      id: `tl:${e.event_id}`,
      timeNs: e.event_time_ns,
      kind,
      service: e.service ?? null,
      text: e.summary,
    });
  }
  for (const n of evidenceGraph?.graph.nodes ?? []) {
    if (n.time_ns == null) continue;
    // change/log evidence nodes duplicate the timeline entries above
    if (n.kind === "change" || n.kind === "log_pattern") continue;
    items.push({
      id: `ev:${n.id}`,
      timeNs: n.time_ns,
      kind: n.kind,
      service: n.service ?? null,
      text:
        n.kind === "service_degradation"
          ? `${n.service ?? "service"} degraded`
          : n.kind === "root_cause_candidate"
            ? `${shortEvidenceLabel(n)} ranked`
            : `${n.service ?? ""} ${shortEvidenceLabel(n)}`.trim(),
    });
  }
  const visible = cursorNs == null ? items : items.filter((i) => i.timeNs <= cursorNs);
  visible.sort((a, b) => b.timeNs - a.timeNs || a.id.localeCompare(b.id));
  return visible.slice(0, limit);
}
