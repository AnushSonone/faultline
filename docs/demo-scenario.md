# Canonical demo scenario (TA-053)

Incident: `rec-mem-001` (synthetic Online Boutique-style MEM fault). Every step
maps to spec section 5's demo flow. Total runtime ~3 minutes at 10x speed.

| # | Action | What to say / see |
|---|---|---|
| 1 | `make demo`, open http://127.0.0.1:5173 | Healthy service graph, all quiet |
| 2 | Press Play | Event-time clock advances; WS projections stream in |
| 3 | t=5s: deploy marker on timeline | "A deployment lands on recommendationservice" |
| 4 | Overview: rec memory ramps | Anomaly onset detected by rolling median/MAD baselines |
| 5 | Signals tab: heatmap | rec row brightens first (streaming DDSketch p99), then checkout/frontend follow |
| 6 | Root causes tab | Ranking updates as evidence arrives: rec #1 at ~0.92 |
| 7 | Expand #1 card | 9-component score decomposition; click `anomaly_strength` - evidence list filters (spec 20.6) |
| 8 | Evidence graph | deploy -> precedes -> rec degradation -> propagates_to -> checkout/frontend; dashed red = contradicts |
| 9 | Signals tab: pick failed trace | Waterfall with critical-path highlight; "Critical path only" filter |
| 10 | "vs healthy" toggle | Median healthy reference, per-span deltas, comparability confidence |
| 11 | Runtime tab: Checkpoint now | 13 ms atomic checkpoint, size shown |
| 12 | Crash test | In-memory state destroyed; recovery from disk; "no duplicate evidence after recovery" |
| 13 | Query plan inspector | Run the p99 SQL query; EXPLAIN trees; results match the heatmap exactly (same DDSketch) |
| 14 | Scrub back to t=0 | Everything rewinds consistently; ranking empties (cursor-bounded truth) |

Claim-discipline phrases to use on camera: "likely cause", "supports / contradicts",
"approximate p99 via DDSketch", "checkpoint recovery with idempotent projections".
Never: "proven root cause", "exactly-once", "validated on production data".

Scripted seek points: 0s (healthy), 5.0s (deploy), 8.5s (first errors), 15s (full incident).
