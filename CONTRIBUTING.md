# Contributing

## Ground rules

1. Short-lived branches: `area/ta-NNN-slug`. Keep tickets independently testable.
2. Interface changes update Rust types, TS mirrors (`web/src/types/protocol.ts`), docs, fixtures, and tests together.
3. No invented numbers: anything quantitative goes through `scripts/run-benchmarks.sh` and lands in RESULTS.md with the integrity block.
4. Claim discipline (see README): approximate percentiles, checkpoint recovery (not exactly-once), synthetic vs real data always labeled.
5. Determinism is a feature: rankings, evidence ids, plans, and goldens must be reproducible byte-for-byte. Golden updates: `UPDATE_GOLDEN=1 cargo test`.

## Local loop

```bash
make demo                 # run the product
cargo test --workspace    # Rust suites
cargo clippy --workspace --all-targets   # zero warnings expected
cd web && npm run test:e2e               # needs make demo running
```

## Where things live

- Engine operators: `crates/engine/src/operators/`
- Inference features/ranking/evidence: `crates/inference/src/`
- Checkpoint format: `crates/state/` + ADR 0021
- SQL planner: `crates/planner/src/`
- WS/REST surface: `crates/api/src/`
- UI panels: `web/src/views/<Name>/`
- ADRs: `docs/adr/` — add one for any architectural decision

Good starting points: `docs/good-first-issues.md`.
