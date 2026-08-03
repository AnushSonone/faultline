# ADR 0016: Percentile accuracy contract

**Status:** Accepted  
**Date:** 2026-07-21

## Contract (UI-safe)

Before exposing p50/p95/p99 in the product UI:

- Relative error vs exact sorted percentile ≤ **2%** on controlled uniform / normal-like / skewed fixtures with α=0.01, OR
- Absolute error ≤ **1.0** for very small windows / near-zero truths

Heavy-tail and extreme-outlier cases may exceed 2% relative error at the far tail; the inspector can show validation error when validation mode is enabled.

## Non-claims

Do not publish throughput numbers as project claims. Internal benches only.
