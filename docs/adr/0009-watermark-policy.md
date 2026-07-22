# ADR 0009: Bounded out-of-orderness watermarks

## Decision

Use per-partition watermarks `max_event_time - allowed_lateness`, with global watermark = minimum among active non-idle partitions. Configure lateness, late-revision grace, idle timeout, and reorder buffer max size.

## Consequences

Deterministic event-time progress without waiting forever for silent partitions. Late events within grace can revise; beyond grace are audited only.
