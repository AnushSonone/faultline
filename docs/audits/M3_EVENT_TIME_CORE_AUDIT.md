# M3 Event-Time Core Audit

**Date:** 2026-07-21  
**Branch:** `runtime/m3-event-time-core`  
**Base:** `main` @ merge of `audit/m2-completion`

## Verdict

**`M3 CORE PASSED`**

TA-021…025 are implemented, tested, and the service×time heatmap is powered by the streaming path by default. Topology/timeline/traces remain precomputed. TA-026+ not started.

## Architecture implemented

1. `WatermarkTracker` (per-partition reorder, lateness, idle, beyond-grace audit)
2. Signal-specific Arrow `MultiSignalBatcher`
3. Bounded `SyncRuntime` + operator trait (`on_batch` / `on_watermark` / snapshot / metrics)
4. Filter / Projection / HashAggregate / Window (tumbling+hopping) / HeatmapSink
5. `HeatmapStreamingPipeline` wired into sessions with `projection_mode`
6. Minimal runtime inspector WS + UI panel
7. Seeded adversarial arrival schedule for metrics

## Tickets

| Ticket | Status |
|--------|--------|
| TA-021 | Complete |
| TA-022 | Complete |
| TA-023 | Complete |
| TA-024 | Complete (programmatic plans) |
| TA-025 | Complete (tumbling used by heatmap; hopping covered by unit tests) |
| TA-026+ | Not started |

## Precomputed vs streaming

| Component | Mode |
|-----------|------|
| Heatmap | Streaming default; toggle to precomputed |
| Topology / timeline / traces | Precomputed only |
| Inference / SQL / checkpoints | Absent |

## Event-time / late behavior

- Partition WM = max_et - allowed_lateness; global = min active non-idle; never decreases.
- Late revisable vs beyond-grace classified; beyond-grace counted, not buffered into query state.
- Window emits carry revision + finalized; sink replaces cells by revision.
- Seek/reset rebuilds streaming state from envelopes ≤ cursor.

## Heatmap parity

Streaming rebuild on synthetic fixture produces non-empty service×bucket cells; seek rebuild is deterministic. Exact numeric parity with precomputed mean-of-mixed-metrics is not required (streaming uses per-window averages of filtered lat/err/mem metrics). Toggle remains for regression comparison.

## Commands run

- `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`
- Python pytest, web tsc/vitest/build/playwright
- M2 demo regression + streaming heatmap path via API session load

## Known limitations

- Streaming rebuild scans envelopes each publish (correctness-first; not incremental hot path yet)
- Heatmap metric mix still lat/err/mem filtered average, not a dedicated latency column query
- Playwright does not yet assert inspector watermark progression
- Percentile / temporal join / full Query Inspector deferred

## Next recommended ticket

**TA-026 percentile operator**, then TA-027 temporal join, then TA-028/029 inspector polish.

## Commits (this branch)

```text
9d664f9 docs: start M3 event-time runtime
3ea137a feat(ingest): add reorder buffers, watermarks, and Arrow batching
3b57886 feat(engine): add bounded runtime, operators, and event-time windows
4a4d473 feat(projection): stream heatmap updates with dual projection modes
7c82188 feat(web): add runtime inspector and heatmap mode controls
6a5d25d docs: record M3 event-time core status
6c72f94 chore: apply rustfmt after M3 core land
```
