// Short, layout-safe labels for graph nodes. The server's labels are complete
// sentences ("recommendationservice_latency anomaly (peak |z| 8.0)"); in a
// lane layout the lane and the service group already say most of that, so
// the on-canvas label keeps only what is new. The full label survives as the
// hover tooltip.

export type LabelSource = {
  kind: string;
  label: string;
  service?: string | null;
  // Set on condensed nodes: how many raw anomalies this one stands for.
  count?: number;
  // Verbatim label for synthetic summary nodes.
  summary?: string;
};

const ANOMALY_RE = /^(.*?)\s+anomaly\s*\(peak\s*\|z\|\s*([\d.]+)\)\s*$/i;
const CANDIDATE_RE = /^#(\d+)\s+likely cause:\s*(.+)$/i;

function stripServicePrefix(text: string, service: string | null | undefined): string {
  if (!service) return text;
  if (text.startsWith(`${service}_`)) return text.slice(service.length + 1);
  if (text.startsWith(`${service} `)) return text.slice(service.length + 1);
  return text;
}

export type ParsedAnomaly = { metric: string; z: string };

// "recommendationservice_latency anomaly (peak |z| 8.0)" -> latency, 8.0
export function parseAnomaly(
  label: string,
  service: string | null | undefined,
): ParsedAnomaly | null {
  const m = ANOMALY_RE.exec(label.trim());
  if (!m) return null;
  return { metric: stripServicePrefix(m[1].trim(), service).replace(/_/g, " "), z: m[2] };
}

// Plain words for a metric name, shared by the canvas labels and the
// narration so the two never disagree.
export function plainMetric(metric: string): string {
  const m = metric.trim().toLowerCase().replace(/_/g, " ");
  if (/^latency(-\d+)?$/.test(m)) return "got slower";
  if (m === "mem" || m === "memory") return "used more memory";
  if (m === "error rate") return "threw more errors";
  if (m === "cpu") return "CPU maxed out";
  if (m === "workload") return "got busier";
  return `${m} went strange`;
}

export type LabelOptions = {
  // Canvas-only mode for the lane layout: plain words, no service (the group
  // already names it), no z ("new version", "error in logs", "got slower",
  // "suspect #1"). Narration and tooltips use the full form.
  compact?: boolean;
};

export function shortEvidenceLabel(node: LabelSource, opts: LabelOptions = {}): string {
  if (node.summary) return node.summary;
  const base = shortEvidenceLabelBase(node, opts.compact === true);
  return node.count != null && node.count > 1 ? `${base} ×${node.count}` : base;
}

function shortEvidenceLabelBase(node: LabelSource, compact: boolean): string {
  const label = node.label.trim();
  switch (node.kind) {
    case "metric_anomaly": {
      const m = ANOMALY_RE.exec(label);
      if (m) {
        const metric = stripServicePrefix(m[1].trim(), node.service).replace(/_/g, " ");
        return compact ? plainMetric(metric) : `${metric} spike (z ${m[2]})`;
      }
      return stripServicePrefix(label, node.service);
    }
    case "service_degradation":
      return node.service ?? label.replace(/\s+degradation$/i, "");
    case "root_cause_candidate": {
      const m = CANDIDATE_RE.exec(label);
      if (m) return compact ? `suspect #${m[1]}` : `#${m[1]} ${m[2].trim()}`;
      return label;
    }
    case "change":
      return compact ? "new version" : label.replace(/^change on\s+/i, "deploy: ");
    case "log_pattern":
      return compact ? "error in logs" : label.replace(/^high-severity log on\s+/i, "error log: ");
    default:
      return label;
  }
}

// Middle-safe truncation for canvas labels where CSS ellipsis is unavailable.
export function truncateLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// Parse the candidate rank out of a root_cause_candidate label, if present.
export function candidateRank(label: string): number | null {
  const m = CANDIDATE_RE.exec(label.trim());
  return m ? Number(m[1]) : null;
}
