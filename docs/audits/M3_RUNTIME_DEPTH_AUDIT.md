# M3 Runtime Depth Audit

**Branch:** `runtime/m3-query-depth`  
**Date:** 2026-07-21  
**Base:** `main` @ merge of PR #1 (`runtime/m3-event-time-core`)

## Verdict

**`M3 PASSED`**

## Tickets completed

| Ticket | Status |
|--------|--------|
| TA-026 Approximate percentile operator | Complete (DDSketch) |
| TA-027 Stateful temporal join | Complete (left interval join) |
| TA-028 Runtime-inspector backend | Complete (versioned projection v1) |
| TA-029 Runtime-inspector frontend | Complete (overview, DAG, watermark, state) |

Prior core tickets TA-021…025 remain complete on `main`.

## Percentile algorithm and accuracy

- Algorithm: **DDSketch** (`sketches-ddsketch` 0.3.1), α=0.01, 2048 bins
- ADRs: `0015`, `0016`
- Contract: relative error ≤ 2% on controlled fixtures (n≥20); tiny windows use range-based absolute bound
- Tests: `crates/engine/tests/percentile_accuracy.rs` + property tests
- Product: streaming heatmap latency cells use **p99** (`value_source=streaming_p99`)

## Temporal-join semantics

- **Left temporal interval join** (lookback 5s, lookahead 10s)
- ADRs: `0017`, `0018`
- Product language: associated with / supports investigation (not causation)
- UI: deployment correlation panel + timeline deploy marker selection

## Streaming product features

- Streaming p50/p95/p99 on latency metrics
- Streaming deployment correlation cards (before/after p99, delay, evidence refs)
- Adversarial arrival schedule extended (deploy + duplicate + burst + late)

## Runtime inspector

- Versioned DTO (`runtime_projection_version=1`)
- Ingestion / event-time / batching / operators / percentile / join / session / backpressure
- Frontend: collapsible overview, operator graph + detail, watermark bar, architecture honesty
- Cell/operator/correlation linkage without resetting investigation selection

## Streaming versus precomputed boundaries

| Surface | Mode |
|---------|------|
| Heatmap values | streaming (default) |
| Heatmap p95/p99 | streaming percentile |
| Deployment correlation | streaming temporal join |
| Topology structure | precomputed |
| Timeline base events | precomputed |
| Trace waterfall | precomputed |
| Root-cause value | fixture ground truth |
| Root-cause inference | **not implemented** |

Parity classification: `docs/parity/m3-streaming-precomputed.json`

## Test commands and results

```text
cargo fmt --check                          OK
cargo clippy --workspace --all-targets -- -D warnings   OK
cargo test --workspace                     OK (incl. percentile_accuracy)
python3 -m faultline_data.percentile_reference   OK
cd web && npm test                         OK
cd web && npx tsc --noEmit / npm run build OK
cd web && npx playwright test              OK (m2-shell + m3-runtime)
make demo smoke (API health + UI 200)      OK
```

No dedicated `npm run lint` script in `web/package.json`; TypeScript build is the frontend static gate.

## Preliminary performance observations (not project claims)

| Metric | Observation |
|--------|-------------|
| Percentile update throughput | 100k adds in well under 5s in accuracy test harness |
| Percentile state size | Bounded sketch + ≤4096 replay samples; reported state_bytes ≪ raw n |
| Temporal-join state | Grows with unmatched windows/deploys; cleans on watermark |
| Inspector payload | Single JSON object; safe to emit each projection publish |
| Frontend with inspector open | No dedicated profiler run; panel is collapsible/secondary |

Obvious risks watched: full rebuild on seek (correct, not yet incremental); inspector updates with every publish (acceptable for demo scale).

## Known limitations

- Heatmap rebuild still replays envelopes to cursor (not incremental operator state across seeks)
- Precomputed heatmap path remains average-based; do not compare its cell values to streaming p99
- Join restore snapshot is metadata-only (full row restore not required for M3 demo)
- RE2-OB adapter still stub; fixture remains synthetic
- Optional CI Playwright job / branch protection still open (TA-001b)

## Commits (this pass)

See `git log main..HEAD --oneline` on `runtime/m3-query-depth`.

## Recommended next step

First M4 ticket: begin root-cause inference scaffolding only when explicitly requested (do not auto-start). Suggested: evidence object model + weighted feature ranking against fixture labels, without claiming production RCA.

## What remains before broader M3 polish (non-blocking)

Incremental streaming rebuild, CI Playwright, RE2-OB single-case adapter.
