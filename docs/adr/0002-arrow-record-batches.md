# ADR-0002: Arrow RecordBatches

## Status
Accepted

## Context
Operators need a columnar intermediate representation.

## Decision
Use Apache Arrow RecordBatches via arrow-rs / parquet crates, pinned to matching majors (58.x at bootstrap).

## Consequences
Shared memory layout with Parquet; own operator semantics rather than DataFusion execution.
