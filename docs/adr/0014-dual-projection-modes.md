# ADR 0014: Dual precomputed/streaming projection modes

Temporary `projection_mode` flag allows heatmap to run streaming while other views stay on M2 precompute. Default for heatmap is streaming after synthetic-fixture parity. Topology/timeline/traces remain precomputed until later tickets.
