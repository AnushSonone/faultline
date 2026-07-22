# Data flow

```text
Parquet fixture
  → faultline_replay::load_incident (TelemetryEnvelope[])
  → session store

M2 views (topology, timeline, traces):
  envelopes[event_time <= cursor] → graph/timeline/trace builders → WS

M3 heatmap + correlation (default streaming):
  envelopes[event_time <= cursor]
    → (optional adversarial arrival order)
    → WatermarkTracker (TA-021)
    → MultiSignalBatcher metrics + changes (TA-022)
    → FilterExec
         ├─ WindowOperator (avg path)
         └─ PercentileOperator DDSketch p50/p95/p99 (TA-026)
              → HeatmapSinkExec
         └─ TemporalIntervalJoin with deployments (TA-027)
    → heatmap.delta + correlation.snapshot + runtime.inspector (TA-028)
```

Toggle `projection_mode` per session: `streaming` | `precomputed`.
