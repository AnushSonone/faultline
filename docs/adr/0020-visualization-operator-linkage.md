# ADR 0020: Visualization-to-operator linkage

**Status:** Accepted  
**Date:** 2026-07-21

| UI surface | Operator IDs |
|------------|--------------|
| Heatmap latency cell | `latency_percentile`, `heatmap_sink` |
| Heatmap err/mem cell | `heatmap_tumbling`, `heatmap_sink` |
| Deployment correlation card | `deploy_temporal_join` |
| Topology / timeline / traces | none (precomputed) |

Selecting a cell or correlation sets `selectedOperator` without resetting investigation selection of service/time.
