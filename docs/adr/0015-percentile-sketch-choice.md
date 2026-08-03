# ADR 0015: Percentile sketch choice (DDSketch)

**Status:** Accepted  
**Date:** 2026-07-21  
**Tickets:** TA-026

## Decision

Use **DDSketch** (`sketches-ddsketch` 0.3.x) for streaming p50/p95/p99.

## Alternatives considered

| Option | Pros | Cons |
|--------|------|------|
| t-digest | Mature, mergeable | Weaker relative-error guarantees for latency tails |
| KLL (`quantiles`) | Strong rank error theory | Less common in Rust ops stacks; merge APIs vary |
| Exact buffer | Perfect accuracy | Unbounded memory; rejected by ticket |

## Why DDSketch

- Relative-error contract suits skewed latency
- Mergeable, bounded bins
- Snapshot/restore via deterministic replay buffer + sketch rebuild
- Ecosystem crate is small and dependency-light

## Config

- α = 0.01 (default)
- max bins = 2048
- min value = 1e-9
