# Data flow

```text
Parquet fixture
  → faultline_replay::load_incident (TelemetryEnvelope[])
  → session store

M2 views (topology, timeline, traces):
  envelopes[event_time <= cursor] → graph/timeline/trace builders → WS

M3 heatmap (default streaming):
  envelopes[event_time <= cursor]
    → (optional adversarial arrival order)
    → WatermarkTracker (TA-021)
    → MultiSignalBatcher metrics batches (TA-022)
    → FilterExec → WindowOperator → HeatmapSinkExec (TA-023…025)
    → heatmap.delta + runtime.inspector WS messages
```

Toggle `projection_mode` per session: `streaming` | `precomputed`.
