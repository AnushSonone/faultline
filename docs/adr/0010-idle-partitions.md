# ADR 0010: Idle partition handling

## Decision

A partition with no ingest activity for `idle_timeout` is marked idle and excluded from the global watermark minimum. On reactivation, its watermark contribution is `max(local_wm, last_global_wm)` so the global watermark cannot move backward.

## Consequences

Sparse signal partitions cannot stall the pipeline indefinitely.
