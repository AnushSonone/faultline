// Plain-English sentences for the "What just happened" feed. One template per
// evidence kind; anything unknown falls back to the raw text. Metric words
// come from labels.ts so the canvas and the feed never disagree.

import type { NarrationItem } from "./narration";
import { parseAnomaly, plainMetric } from "./labels";

export function sentenceFor(item: NarrationItem): string {
  const svc = item.service ?? "a service";
  switch (item.kind) {
    case "change":
      return /deploy/i.test(item.text) ? `${svc} got a new version` : `${svc} changed: ${item.text}`;
    case "log_pattern":
      return `${svc} logged: ${item.text}`;
    case "metric_anomaly": {
      // item.text is "<service> <metric> spike (z 8.0)" or a raw label
      const m = /spike \(z ([\d.]+)\)/.exec(item.text);
      const raw = /^(\S+)\s+(.*?)\s+spike/.exec(item.text);
      if (m && raw) return `${svc} ${plainMetric(raw[2])} (z ${m[1]})`;
      const parsed = parseAnomaly(item.text, item.service);
      if (parsed) return `${svc} ${plainMetric(parsed.metric)} (z ${parsed.z})`;
      return `${svc}: ${item.text}`;
    }
    case "service_degradation":
      return `${svc} is now struggling`;
    case "root_cause_candidate": {
      const m = /#(\d+)/.exec(item.text);
      return m ? `${svc} is now suspect #${m[1]}` : `${svc} is now a suspect`;
    }
    default:
      return item.text;
  }
}
