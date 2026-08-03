# Good first issues

Each is scoped, independently testable, and touches one subsystem.

1. **Incident picker UI** - the API lists incidents (`GET /api/v1/incidents`) but the UI hardcodes `rec-mem-001`. Add a dropdown in the header that reloads the session with the chosen incident. (web/src/app, api/client.ts)
2. **HOP window in the heatmap** - the engine supports hopping windows; the heatmap pipeline only uses tumbling. Wire a UI toggle + pipeline config. (crates/engine/heatmap_pipeline.rs, web AnomalyHeatmap)
3. **Evidence graph edge tooltips** - edges carry labels but no hover detail. Surface `label` + timestamps on hover. (web/src/views/EvidenceGraph)
4. **`faultline-cli validate` for real** - the subcommand is a stub; wire it to `faultline_catalog::validate_incident_dir`. (apps/faultline-cli, crates/catalog)
5. **Seasonal baseline** - spec 18.2 lists a seasonal time-bucket baseline as an alternative; implement behind `BaselineConfig` and compare on the eval suite. (crates/inference/baseline.rs)
6. **Burst disorder mode** - `DisorderConfig.burst_size` is declared but unused; implement burst emission in `DisorderInjector::next_action` with tests. (crates/replay/disorder.rs)
7. **SQL `HOP` end-to-end test** - the parser accepts `HOP(...)` but no test covers it through execution. (crates/planner/tests)
8. **Convert more RCAEval cases** - Phase B: all 90 RE2-OB cases with an incident-level train/validation/test split manifest. (python adapters/rcaeval.py, docs/references)
9. **Weight tuning on a training split** - grid-search `RankingWeights` on train, report train/test separately next to untuned numbers. (crates/cli/evaluate.rs)
10. **Trace waterfall virtualization** - long traces render every span row; virtualize for the 4k-span RCAEval traces. (web/src/views/TraceWaterfall)
