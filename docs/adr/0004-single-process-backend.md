# ADR-0004: Single-process backend

## Status
Accepted

## Context
Splitting faultlined into network microservices adds failure modes without portfolio value.

## Decision
One process (`faultlined`) with internal Rust crates for module boundaries.

## Consequences
Simpler demos and checkpoints; no distributed scheduler in v1.
