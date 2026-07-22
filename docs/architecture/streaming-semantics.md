# Streaming semantics (M3)

**Status:** M3 runtime depth (TA-021…029)  
**Date:** 2026-07-21

## Modes

| Mode | Heatmap | Topology / timeline / traces | Deployment correlation |
|------|---------|------------------------------|------------------------|
| `precomputed` | Cursor-filtered envelope scan (M2 avg) | M2 precompute | Precomputed assist scan |
| `streaming` | Watermarks → batches → filter → window avg + DDSketch percentiles → sink | Still M2 precompute | Streaming left temporal join |

Default for heatmap: `streaming`. Latency cells use **streaming p99**. Topology / timeline base / traces remain precomputed.

## Event time

- Assignment uses `TelemetryEnvelope.event_time_ns`.
- Replay wall speed must not change finalized event-time results.
- Ordering key: `(event_time_ns, ingest_sequence, event_id)`.

## Watermarks

```text
partition_watermark = max_event_time_observed - allowed_lateness
global_watermark = min(active non-idle partition watermarks)
```

Invariants: never move backward; idle partitions time out; reactivation cannot rewind the global watermark below the last emitted value (new partitions start at `max(local, global)` for contribution).

## Late events

| Class | Behavior |
|-------|----------|
| on_time / buffered | Emit in event-time order when watermark advances |
| late_revisable | May revise open/finalizing window results |
| beyond_grace | Counted for audit; does not mutate finalized windows |
| duplicate / invalid | Dropped from results; counted |

## Windows

Tumbling and hopping only (no session windows). Emissions carry `window_id`, `revision`, `finalized`, and watermark at emit time. Frontend replaces by `(query_id, window_id, revision)`.

## Percentiles

DDSketch α=0.01. Acceptable UI bound: relative error ≤ 2% vs exact sorted reference on controlled fixtures (see ADR 0016).

## Temporal join

Left interval join of latency windows to deployments within lookback/lookahead. Not causation.

## Remaining before M3 fully closed historically

This pass completes TA-026…029. Optional follow-ups (not blocking M3 acceptance here): incremental heatmap rebuild without full seek replay, CI Playwright job, RE2-OB adapter.
