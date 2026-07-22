# Visualization contracts

| View | Powered by | Notes |
|------|------------|-------|
| Service map | Precomputed | Span graph until cursor |
| Timeline | Precomputed base events | Deploy markers selectable; association via streaming join |
| Trace waterfall | Precomputed | Cursor-bounded DAG |
| Anomaly heatmap | **Streaming (default)** or precomputed | Latency: streaming p99; err/mem: window avg |
| Deployment correlation | Streaming temporal join | Language: associated with / supports investigation |
| Runtime inspector | Versioned runtime projection | Operators, watermarks, queues, sketches, join state |

Heatmap streaming cells may include `p50`/`p95`/`p99`, `operator_id`, `window_id`, `value_source`. Frontend replaces the full heatmap payload on each `heatmap.delta`.
