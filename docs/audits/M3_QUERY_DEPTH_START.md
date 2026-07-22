# M3 query-depth pass start

**Branch:** `runtime/m3-query-depth`  
**Base:** `main` after merge of PR #1 (`runtime/m3-event-time-core`)  
**Date:** 2026-07-21

## Confirmed streaming boundary (unchanged claims)

| Surface | Mode |
|---------|------|
| Heatmap values | streaming |
| Topology structure | precomputed |
| Timeline base events | precomputed |
| Trace waterfall | precomputed |
| Root-cause value | synthetic fixture ground truth |
| Root-cause inference | not implemented |

## Tickets in this pass

- TA-026 approximate percentile operator
- TA-027 stateful temporal join
- TA-028 runtime-inspector backend projections
- TA-029 polished runtime-inspector frontend

## Out of scope

M4 root-cause inference (do not start).
