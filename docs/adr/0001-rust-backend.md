# ADR-0001: Rust backend

## Status
Accepted

## Context
Faultline needs a systems-oriented streaming runtime with strong ownership of event-time semantics.

## Decision
Implement the backend in Rust using Tokio and Axum.

## Consequences
Strong resume signal; longer bootstrap; excellent Arrow/Tokio ecosystem fit.
