// Plain-words names for the nine score components (plus the unweighted
// persistence feature). `plain` is the primary label in the score table;
// `detail` is one sentence for the tooltip. Technical names stay visible as
// secondary text so engineers can still map rows to spec 18.4.

export type ComponentCopy = { plain: string; detail: string };

export const COMPONENT_COPY: Record<string, ComponentCopy> = {
  anomaly_strength: {
    plain: "Its own numbers strayed from normal",
    detail: "How far its metrics moved from that service's usual behaviour.",
  },
  temporal_precedence: {
    plain: "Went wrong before the services that depend on it",
    detail: "Whether it was already misbehaving when its callers started to.",
  },
  failed_trace_coverage: {
    plain: "Failed requests passed through it",
    detail: "The share of failed requests whose path included this service.",
  },
  critical_path_contribution: {
    plain: "Sits on the slowest part of the request path",
    detail: "How much of the extra delay in slow requests happened inside it.",
  },
  downstream_impact: {
    plain: "The services that depend on it slowed down",
    detail: "How many of the other struggling services are downstream of it.",
  },
  topology_consistency: {
    plain: "The pattern of slow services fits its position",
    detail: "Whether the struggling services are the ones its call paths would explain.",
  },
  change_proximity: {
    plain: "Got a new version just before things went wrong",
    detail: "A deployment landed shortly before its numbers moved.",
  },
  log_evidence: {
    plain: "Its logs show errors",
    detail: "Error-level log lines that line up with the incident.",
  },
  contradiction_penalty: {
    plain: "Evidence against it",
    detail: "Callers that went wrong before it did.",
  },
  persistence: {
    plain: "How long it stayed unwell",
    detail: "The share of the incident during which it was misbehaving. Shown, but not scored.",
  },
};
