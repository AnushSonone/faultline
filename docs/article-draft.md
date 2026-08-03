# I built a streaming incident-replay engine to learn why observability tools feel like magic (draft, TA-054)

Every incident-review tool I have used shows dashboards of what happened.
Almost none let you *rewind the incident* - scrub back to before the deploy,
watch the anomaly propagate hop by hop, and interrogate why the tool believes
service X caused it. Faultline is my attempt to build that from the raw
primitives, in Rust, with no AI black box in the causal path.

## The parts vendors abstract away

The whole point was to own the machinery observability vendors sell:

- **Event time, not wall time.** Telemetry arrives late and out of order.
  Faultline tracks per-partition watermarks with bounded out-of-orderness,
  buffers reorders, and revises finalized windows within a grace period. The
  UI shows revisions instead of pretending they never happen.
- **Sketches, not sorted arrays.** Latency percentiles come from DDSketch at
  alpha 0.01. The heatmap's p99, the SQL engine's `P99(...)`, and the
  benchmark suite share one implementation - so a SQL query provably matches
  the pixel on screen.
- **A join with retention semantics.** "Deployment near anomaly" is a left
  temporal interval join with explicit lookback/lookahead and grace, its
  state snapshot-restorable byte for byte.
- **Checkpoints that survive being lied to.** Manifest written last, sha256
  per file, atomic renames, LATEST pointer flipped only after a fully valid
  directory exists. Recovery falls back past corrupt checkpoints and proves
  it minted no duplicate evidence. Claim: checkpoint recovery with idempotent
  incident projections. Not exactly-once - the honest phrase matters.
- **A planner, because SQL is a UI too.** A hand-rolled subset (windows,
  percentile aggregates, one constrained temporal join) lowers through nine
  logical nodes, six rewrite rules, and executes on the same operators the
  product uses. EXPLAIN ANALYZE shows rows, batches, and wall time.

## Deterministic root-cause ranking

The RCA layer is ten features - anomaly strength via rolling median/MAD
robust z-scores, temporal precedence, failed-trace coverage, real
critical-path attribution, dependency topology, change proximity, log
evidence, persistence, and an explicit contradiction penalty - combined by a
fixed weighted sum. Every candidate's score decomposes in the UI; clicking a
component filters the evidence; contradicting evidence is rendered, not
suppressed. Determinism is enforced by golden tests: same input, same bytes.

## What real data did to my beautiful numbers

On my 16-incident synthetic suite the ranking is perfect - 100% top-1, robust
to every single-feature ablation. Satisfying, and nearly meaningless: I
generated those faults, so of course they are separable.

Then I converted 15 real fault-injection cases from RCAEval RE2-OB (real
Online Boutique deployments, CPU/mem/delay faults) and ran the same untuned,
train-free pipeline blind: **26.7% top-1, 46.7% top-3, MRR 0.41.** The
ablations got interesting: remove topology consistency and top-1 collapses to
6.7%; remove temporal precedence, 13.3%. Meanwhile change proximity and log
evidence move nothing - RCAEval has no deployment events, so a feature I
weighted at 10% is structurally dead on this dataset. The synthetic suite
could never have told me that.

No published number exists for this exact protocol - the RCAEval paper's
coarse-grained RE2 table covers Train Ticket, not Online Boutique, and reports
Avg@5 (CIRCA 0.46, RCD 0.54), not top-1 - so the only honest comparison is one
I run myself: their harness, locally, on the same cases. An untuned linear
scorer where every number stays explainable is the starting point, not the
destination. The improvement path is written down next to the numbers:
metric-name semantics, trace-latency deltas as anomaly inputs, and weight
tuning on a train split reported against the untuned figures.

## Reproducibility as a feature

`scripts/run-benchmarks.sh` regenerates every number in RESULTS.md and stamps
git commit, machine, toolchain versions, seeds, and dataset checksums. The
rule that shaped the whole project: if a number is not reproducible from a
committed script, it does not get claimed.

Code: https://github.com/AnushSonone/faultline
