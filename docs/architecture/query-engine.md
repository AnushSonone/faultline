# Query engine (M3)

**Status:** M3 runtime depth (TA-021…029)  
**Date:** 2026-07-21

## Owned operators

```text
MetricSource
   ↓
Filter (lat|err|mem)
   ├─→ Tumbling Window (avg for err/mem path into sink)
   └─→ Percentile (DDSketch p50/p95/p99 for latency)
            ↓
      HeatmapSink
            ↑
ChangeSource → TemporalIntervalJoin → Correlation projection
```

## Not implemented

- Arbitrary SQL
- Session windows
- Checkpoint persistence to disk (snapshot interfaces exist on operators)
- Root-cause inference (M4)
