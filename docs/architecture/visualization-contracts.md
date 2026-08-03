# Visualization contracts

| View | Powered by | Notes |
|------|------------|-------|
| Service map | Precomputed | Span graph until cursor |
| Timeline | Precomputed base events | Deploy markers selectable; association via streaming join |
| Trace waterfall | Precomputed | Cursor-bounded DAG |
| Anomaly heatmap | **Streaming (default)** or precomputed | Latency: streaming p99; err/mem: window avg |
| Deployment correlation | Streaming temporal join | Language: associated with / supports investigation |
| Runtime inspector | Versioned runtime projection | Operators, watermarks, queues, sketches, join state |
| Likely root causes | Precomputed inference rebuild (`root_causes.snapshot`) | Deterministic ranking + evidence; "likely causes", never proven; ground truth hidden unless the load request sets `evaluation_mode`; score-component click filters evidence |
| Evidence graph | `evidence.updated` | Causal explanation DAG; supports/contradicts edges; strongest-path filter |
| Trace waterfall + comparison | `GET /api/v1/traces/{id}` (TraceDetail) | Critical-path highlight, error-path filter, median-healthy diff with confidence |
| Checkpoint & recovery | `checkpoint.*` / `recovery.*` WS + REST | Crash-test button; recovery report proves no duplicate evidence |
| Query plan inspector | `POST /api/v1/queries` + `query.plan`/`query.metrics` | SQL -> logical/optimized/physical plans; results match product projections |

Heatmap streaming cells may include `p50`/`p95`/`p99`, `operator_id`, `window_id`, `value_source`. Frontend replaces the full heatmap payload on each `heatmap.delta`.
