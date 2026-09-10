// The nine weighted score components plus the unweighted persistence
// feature, as spec 18.4 and README define them. `plain` is the primary label
// in the score table (the technical definition); `detail` is the one-line
// gloss for the tooltip. `weight` mirrors crates/inference/src/ranking.rs
// RankingWeights::default and is only for display; the wire carries the real
// weights per candidate.

export type ComponentCopy = {
  plain: string;
  detail: string;
  // Fixed coefficient in the linear formula. Negative = applied as a penalty.
  // null = computed and shown, never scored.
  weight: number | null;
};

export const COMPONENT_COPY: Record<string, ComponentCopy> = {
  anomaly_strength: {
    plain: "Peak robust z-score against its own baseline, saturated",
    detail: "How far its metrics moved from that service's rolling median, in MAD units.",
    weight: 0.2,
  },
  temporal_precedence: {
    plain: "Anomaly onset preceded its callers' onsets",
    detail: "Rank of its onset among all anomalous services; first is 1.0.",
    weight: 0.15,
  },
  failed_trace_coverage: {
    plain: "Share of failed traces whose span path includes it",
    detail: "Failed traces are those with an error status or an excess-latency span.",
    weight: 0.15,
  },
  critical_path_contribution: {
    plain: "Share of excess critical-path latency attributable to it",
    detail: "Its critical-path time in failed traces beyond its mean in healthy traces.",
    weight: 0.15,
  },
  downstream_impact: {
    plain: "Share of other anomalous services reachable from it as callers",
    detail: "Edges run caller to callee, so a fault propagates to transitive callers.",
    weight: 0.1,
  },
  topology_consistency: {
    plain: "Share of the anomalous set its dependency paths explain",
    detail: "Ablation shows this feature carries real data: top-1 drops from 26.7% to 6.7% without it.",
    weight: 0.1,
  },
  change_proximity: {
    plain: "Deployment shortly before onset (left temporal interval join)",
    detail: "1 minus delay over the change window for the nearest deployment at or before onset.",
    weight: 0.1,
  },
  log_evidence: {
    plain: "Correlated high-severity logs near onset, saturating",
    detail: "Error-level log lines within the log window, saturating at three.",
    weight: 0.05,
  },
  contradiction_penalty: {
    plain: "Share of impacted callers whose onset preceded its own",
    detail: "Negative evidence, applied as a penalty and never hidden.",
    weight: -0.1,
  },
  persistence: {
    plain: "Share of the incident span during which it was anomalous",
    detail: "Computed and shown, but carries no weight in the score.",
    weight: null,
  },
};
