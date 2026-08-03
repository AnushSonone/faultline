# ADR 0019: Runtime inspector protocol

**Status:** Accepted  
**Date:** 2026-07-21  
**Tickets:** TA-028 / TA-029

## Decision

Expose a versioned `RuntimeInspectorDto` (`runtime_projection_version = 1`) on:

- WS: `runtime.inspector`
- REST: `GET /api/v1/sessions/{id}/runtime`

Separated from user telemetry projections. Bounded, deterministic, safe to poll. No memory addresses or unstable debug formatting.
