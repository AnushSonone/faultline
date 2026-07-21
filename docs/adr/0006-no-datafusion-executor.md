# ADR-0006: No DataFusion executor

## Status
Accepted

## Context
Owning planner/executor semantics is a core learning goal.

## Decision
Use sqlparser-rs for syntax only. Faultline owns logical/physical plans and streaming operators.

## Consequences
Slower SQL delivery; clearer interview story; DataFusion may be contribution target later.
