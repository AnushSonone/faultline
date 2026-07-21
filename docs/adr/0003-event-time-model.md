# ADR-0003: Event-time model

## Status
Accepted

## Context
Telemetry arrives late and out of order.

## Decision
Treat event_time, observed_time, and ingest_time as distinct fields. Processing time is never source truth.

## Consequences
Watermarks and late-event revision are first-class (M3+).
