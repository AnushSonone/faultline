# Checkpointing and recovery

See ADR 0021 for the decision record. Mechanics:

## Write path (`crates/state/src/store.rs`)

1. temp dir `.tmp-<id>` under the session's checkpoint root
2. `snapshot.json` written and fsynced
3. sha256 per file
4. `manifest.json` written last (schema_version, checkpoint id, files with
   checksums and sizes)
5. atomic rename `.tmp-<id>` -> `cp-<id>`
6. atomic LATEST pointer replacement

## Snapshot contents (`crates/state/src/snapshot.rs`)

Session metadata, replay position (start/end/cursor/state/speed), global
watermark, monotonic counters, operator state blobs (window, percentile,
temporal join - full buffers and dedupe keys), deterministic evidence ids at
the cursor.

## Recovery path (`crates/state/src/recovery.rs`)

LATEST -> validate manifest + checksums -> fall back to older checkpoints on
corruption -> restore incident data from disk -> seek to checkpoint cursor ->
`Operator::restore` for each stateful operator -> republish projections
(idempotent by construction) -> verify the recomputed evidence-id set matches
the checkpoint (no duplicates, nothing lost).

## Failure matrix (tested in `crates/state/src/tests.rs`)

crash mid-write, corrupted latest, missing manifest, manifest id mismatch,
all-corrupt, empty store, missing LATEST pointer, round-trip equivalence.

## Metrics

`checkpoint_duration_seconds`, `checkpoint_bytes` (write), and
`recovery_duration_seconds` (recovery) are returned by the API and shown in
the Runtime tab.

Claim: checkpoint recovery with idempotent incident projections. Not
exactly-once.
