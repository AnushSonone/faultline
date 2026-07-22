# Visualization contracts

| View | Powered by | Notes |
|------|------------|-------|
| Service map | Precomputed | Span graph until cursor |
| Timeline | Precomputed | Envelope lane until cursor |
| Trace waterfall | Precomputed | Cursor-bounded DAG |
| Anomaly heatmap | **Streaming (default)** or precomputed | Tumbling 1s windows by service; revisions replace |

Heatmap streaming cells include `projection_version`. Frontend replaces the full heatmap payload on each `heatmap.delta` (M2 type name retained).
