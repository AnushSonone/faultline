# Demo video script (TA-054) - ~2:30, recording is a human step

**0:00-0:15 - Hook (Overview tab, paused at t=0)**
"This is Faultline. It replays cloud incidents like a video - metrics, traces,
logs, and deployments on one event-time clock - and ranks likely root causes
with evidence you can actually inspect. The engine is Rust I wrote from
scratch: watermarks, windows, sketches, joins, checkpoints. No LLM anywhere in
the inference path."

**0:15-0:45 - The incident (press Play)**
"A deployment lands on the recommendation service... memory starts climbing...
and the anomaly heatmap lights up - that's a streaming DDSketch p99, computed
by the engine as events arrive, out-of-order safe. Downstream, checkout and
frontend latency follow."

**0:45-1:20 - Root causes (Root causes tab)**
"The ranking pinned recommendationservice at 0.92. This isn't a guess - it's a
weighted sum of ten deterministic features. Click the score: anomaly strength,
temporal precedence, dependency topology, each with its weight and
contribution. Click a component and the evidence list filters to the raw
telemetry behind it. Contradicting evidence stays visible - the system argues
against itself in public. The evidence graph shows the causal chain: deploy,
degradation, propagation to callers."

**1:20-1:45 - Traces (Signals tab)**
"Pick a failed trace: the critical path is highlighted - longest causally valid
path, not a sum of spans. Compare against the median healthy trace: per-span
deltas, added services, comparability confidence."

**1:45-2:10 - Crash test (Runtime tab)**
"Now the fun part. Checkpoint: 13 milliseconds, atomic, checksummed. Crash
test: I just destroyed every byte of in-memory session state. Recovery reads
the checkpoint, restores operator state - window aggregates, sketch state, join
buffers - and re-emits projections idempotently. Zero duplicate evidence."

**2:10-2:30 - SQL + close (Query plan inspector)**
"Everything the UI shows is queryable: here's the p99 heatmap as SQL, through
my own parser, planner, and optimizer, executing on the same operators -
results match the heatmap exactly. Evaluated blind on real RCAEval incident
data with honest, reproducible numbers in RESULTS.md. Code's on GitHub."

Recording notes: 1440p, dark theme (default), cursor highlights on, 10x replay
speed, pre-warm with `make demo` and one full play-through first.
