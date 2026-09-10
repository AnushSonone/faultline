// One sentence per evidence kind for the evidence timeline. Anything unknown
// falls back to the raw text. Metric terms come from labels.ts so the canvas
// and the feed never disagree.

import type { NarrationItem } from "./narration";
import { metricTerm, parseAnomaly } from "./labels";

export function sentenceFor(item: NarrationItem): string {
  const svc = item.service ?? "a service";
  switch (item.kind) {
    case "change":
      return /deploy/i.test(item.text) ? `deployment on ${svc}` : `change event on ${svc}: ${item.text}`;
    case "log_pattern":
      return `${svc} error-log pattern: ${item.text}`;
    case "metric_anomaly": {
      // item.text is "<service> <metric> spike (z 8.0)" or a raw label
      const m = /spike \(z ([\d.]+)\)/.exec(item.text);
      const raw = /^(\S+)\s+(.*?)\s+spike/.exec(item.text);
      if (m && raw) return `${svc} ${metricTerm(raw[2])} anomaly (robust z ${m[1]})`;
      const parsed = parseAnomaly(item.text, item.service);
      if (parsed) return `${svc} ${metricTerm(parsed.metric)} anomaly (robust z ${parsed.z})`;
      return `${svc}: ${item.text}`;
    }
    case "service_degradation":
      return `${svc} degradation onset`;
    case "root_cause_candidate": {
      const m = /#(\d+)/.exec(item.text);
      return m ? `${svc} ranked candidate #${m[1]}` : `${svc} entered the candidate set`;
    }
    default:
      return item.text;
  }
}
