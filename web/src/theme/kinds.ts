import { COLORS } from "./tokens";

// Evidence kind → colour. Read at draw time so the light theme swap applies.
export const KIND_COLORS: Record<string, string> = new Proxy(
  {},
  {
    get(_t, kind: string) {
      switch (kind) {
        case "change":
          return COLORS.warn;
        case "metric_anomaly":
          return COLORS.accent;
        case "log_pattern":
          return COLORS.muted;
        case "service_degradation":
          return COLORS.danger;
        case "root_cause_candidate":
          // A candidate is a hypothesis to check, not a good outcome: the
          // alert orange keeps it away from the green "resolved" reading.
          return COLORS.alert;
        default:
          return COLORS.accent;
      }
    },
  },
);

export const KIND_LABELS: Record<string, string> = {
  change: "change event",
  log_pattern: "error-log pattern",
  metric_anomaly: "metric anomaly",
  service_degradation: "service degradation",
  root_cause_candidate: "root-cause candidate",
};
