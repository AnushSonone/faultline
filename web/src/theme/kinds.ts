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
          return COLORS.ok;
        default:
          return COLORS.accent;
      }
    },
  },
);

export const KIND_LABELS: Record<string, string> = {
  change: "new version",
  log_pattern: "error in logs",
  metric_anomaly: "strange number",
  service_degradation: "service got slow",
  root_cause_candidate: "suspect",
};
