# Streaming semantics (M3 core)

**Status:** M3 event-time core (TA-021…025)  
**Date:** 2026-07-21

## Modes

| Mode | Heatmap | Topology / timeline / traces |
|------|---------|------------------------------|
| `precomputed` | Cursor-filtered envelope scan (M2) | M2 precompute |
| `streaming` | Event-time ingest → Arrow batches → operators → windowed aggregate sink | Still M2 precompute |

Default for heatmap after parity: `streaming`. Other views remain precomputed until later tickets.

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
