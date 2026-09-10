// Copy for the Runtime tab: one lead sentence per section, one line per
// operator type, and short definitions for the terms the info tips carry.
// Technical register throughout. Numbers here mirror the hand-built demo
// pipeline in crates/engine/src/heatmap_pipeline.rs (allowed lateness 2 s,
// revision grace 1 s, join interval [-5 s, +10 s], batches of 64 rows).

export type RuntimeSectionCopy = { title: string; lead: string };

export const RUNTIME_SECTIONS = {
  glance: {
    title: "Engine at a glance",
    lead:
      "Live counters from the versioned runtime projection (ADR 0019), republished on every replay tick and computed at the cursor unless the provenance table says otherwise.",
  },
  pipeline: {
    title: "Operator pipeline",
    lead:
      "A hand-built operator DAG, not a compiled plan: metric source, name filter, 1 s tumbling window keyed by service, DDSketch percentiles, a temporal join against deployments, and the heatmap sink; click a node for its counters.",
  },
  eventTime: {
    title: "Event time and watermarks",
    lead:
      "Every operator runs on event time: the watermark trails the maximum event time seen by the 2 s allowed lateness, events inside the 1 s revision grace re-open their window, anything later is counted and dropped.",
  },
  ingestion: {
    title: "Ingestion and batching",
    lead:
      "Envelopes are de-duplicated, validated and coalesced into Arrow batches of up to 64 rows before entering the DAG; the flush reasons show whether batches fill or age out.",
  },
  query: {
    title: "Query workbench",
    lead:
      "A SQL subset over the replayed events, planned into the same operator kinds the live pipeline uses and executed at the replay cursor with EXPLAIN ANALYZE.",
  },
  scoring: {
    title: "Scoring formula",
    lead:
      "Candidates are ranked by a fixed linear formula over nine features in [0, 1] minus a contradiction penalty; the weights are a stated hypothesis (spec 18.4), not a fit.",
  },
  checkpoint: {
    title: "Checkpoint and recovery",
    lead:
      "A checkpoint writes replay position, watermark, operator state and emitted evidence ids atomically (ADR 0021); crash test drops in-memory state and recovers from it, so the evidence set must match the checkpointed one. Recovery, not exactly-once.",
  },
  provenance: {
    title: "Streaming vs precomputed",
    lead:
      "What the streaming operators produce at the cursor versus what is precomputed from the fixture.",
  },
} satisfies Record<string, RuntimeSectionCopy>;

// One line per operator type, keyed by OperatorNode.operator_type. Ghost
// nodes (ids referenced by the DAG that carry no OperatorNode) are keyed by
// their stable id.
export const OPERATOR_COPY: Record<string, string> = {
  MetricSource:
    "Reads replayed envelopes in arrival order, drops duplicates and malformed events, and holds out-of-order events in a bounded reorder buffer (50 000 rows) until the watermark releases them.",
  Filter:
    "Stateless predicate on metric name (contains lat, err or mem). The SQL equivalent is WHERE name LIKE '%lat%' OR name LIKE '%err%' OR name LIKE '%mem%'.",
  Window:
    "Tumbling 1 s event-time window keyed by service (TUMBLE(event_time, '1s') GROUP BY service). A window closes when the watermark passes its end; a late event inside the 1 s grace re-opens it as a revision.",
  P99:
    "One DDSketch per window and key, with relative-error bound alpha. p50, p95 and p99 are read from the sketch, so state is a few KB per key instead of every sample. EXPLAIN ANALYZE compiles P99(value) to this same operator.",
  TemporalJoin:
    "Left interval join of percentile windows against deployments on service, matching change events within [-5 s, +10 s] of the window. Rows expire from both sides once the watermark clears the interval plus 1 s grace.",
  HeatmapSink:
    "Materializes window and percentile emits into the heatmap projection and increments heatmap_revisions on every late revision. This is what the Telemetry tab draws.",
  change_source:
    "Deployment change events read straight from the replay. Not an instrumented operator, so no counters.",
  correlation_sink:
    "Correlation projection consumed by the Ranking tab. Not instrumented.",
};

export const TERMS: Record<string, string> = {
  watermark:
    "Event-time watermark: the engine's claim that no event older than this will still arrive. Global = min over active, non-idle partitions.",
  lateness:
    "Allowed lateness (bounded out-of-orderness): how far the watermark trails the maximum event time seen. Events inside it are on time.",
  grace:
    "Late-revision grace: an event behind the watermark but inside this grace re-opens its window as a new revision instead of being dropped.",
  revision:
    "Window revision: monotonic counter per window id. The frontend replaces a cell by (window, revision), so late data corrects a pixel in place.",
  backpressure:
    "Queue utilization = depth over capacity on each bounded operator channel. The limiting operator is the argmax; saturation means an upstream stage is blocked.",
  state:
    "Bounded operator state in bytes: open windows, DDSketch buckets, join buffers. Retention ends at watermark plus grace.",
  ddsketch:
    "DDSketch: a mergeable quantile sketch with a relative-error bound alpha. p99 read from the sketch is within alpha of the exact p99 in relative terms.",
  partition:
    "Partitions carry their own watermark (one per metric series or trace). An idle partition is excluded from the global watermark so it cannot stall progress.",
  checkpoint:
    "A versioned, checksummed snapshot of replay position, watermark, operator state and emitted evidence ids, written manifest-last so a torn write is never LATEST.",
  reorder:
    "Reorder buffer: rows held at the source until the watermark guarantees ordering. Occupancy over capacity (50 000) is the memory cost of out-of-order arrival.",
  partitioning: "Partitioning: how the planner splits work. Session replay is a single partition.",
  retention: "State retention: when closed windows are released. Windows are kept until watermark plus 1 s grace.",
  policy: "Watermark policy: bounded out-of-orderness with 2 s allowed lateness, the same policy the live pipeline runs.",
};
