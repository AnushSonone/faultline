# ADR-0007: Cytoscape topology

## Status
Accepted

## Context
Online Boutique-scale graphs (~10–100 services) need stable interactive layout.

## Decision
Use Cytoscape.js for topology and evidence graphs. Replace only after TA-051 proves a bottleneck.

## Consequences
Incremental layout via lock/seed positions; no per-request particles.
