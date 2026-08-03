# Roadmap

- **M0** Repository contract (TA-001…003) — done
- **M1** Real incident replay (TA-004…008) — done via synthetic fixture fallback + ingest/replay path
- **M2** Visual replay (TA-009…020) — accepted 2026-07-21 (`docs/audits/M2_COMPLETION_AUDIT.md`)
- **M3** Event-time runtime + query depth (TA-021…029) — accepted 2026-07-21 (`docs/audits/M3_RUNTIME_DEPTH_AUDIT.md`)
- **M4** Root-cause inference (TA-030…034) — built 2026-07-27: baselines, features, deterministic ranking, evidence, RCA UI; ground truth gated behind evaluation mode
- **M5** Trace comparison + evidence graph (TA-035…038) — built 2026-07-27: critical path, healthy cohort matching, trace diff, causal evidence graph
- **M6** Checkpoint + recovery (TA-039…042) — built 2026-07-27: atomic checksummed checkpoints, corrupt-fallback recovery, crash-test UI, zero duplicate evidence (ADR 0021)
- **M7** SQL planner + EXPLAIN (TA-043…047) — built 2026-07-28: V1 subset, 9-node logical plan, optimizer, physical plan over engine operators, EXPLAIN ANALYZE, query-plan inspector
- **M8** Evaluation + benchmarks (TA-048…051) — built 2026-07-28: 16-incident synthetic suite, real RCAEval RE2-OB Phase-A evaluation, engine/recovery/frontend benchmarks, RESULTS.md
- **M9** Public release (TA-052…054) — in progress: docs, demo scenario, video script; live OTel demo capture and video recording remain human steps

Milestone completion audits for M4+ pending human review; exit-criteria evidence is in tests, RESULTS.md, and e2e specs.
