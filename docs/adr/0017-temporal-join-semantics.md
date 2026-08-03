# ADR 0017: Temporal join semantics

**Status:** Accepted  
**Date:** 2026-07-21  
**Tickets:** TA-027

## Decision

Initial join type: **left temporal interval join**.

```text
telemetry LEFT JOIN deployment
ON telemetry.service = deployment.service
AND deployment.event_time BETWEEN
    telemetry.event_time - lookback
    AND telemetry.event_time + lookahead
```

## Defaults

- lookback = 5s
- lookahead = 10s
- late grace = 1s (aligned with heatmap window grace)

## Product language

Matches are **associated with** / **occurred shortly before** / **support investigation**.  
Never labeled as root-cause inference (M4).
