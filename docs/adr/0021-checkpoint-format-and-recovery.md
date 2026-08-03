# ADR 0021: Checkpoint format and recovery semantics

Date: 2026-07-27
Status: accepted

## Context

Sessions were purely in-memory; every projection is a cursor-bounded rebuild
from envelopes. Spec section 23 requires atomic versioned checkpoints, a
checksummed manifest written last, an atomic LATEST pointer, and recovery that
never duplicates incident alerts or evidence ids. The engine already had an
operator snapshot contract, but only the percentile operator round-tripped
real state.

## Decision

- Checkpoint unit = one session. Directory-per-checkpoint under
  `FAULTLINE_CHECKPOINTS` (default `.faultline-checkpoints/<session-id>/`),
  ids are zero-padded monotonic (`cp-000001`).
- Write order (spec 23): temp dir, flushed `snapshot.json`, sha256 checksums,
  `manifest.json` written last, atomic directory rename, atomic LATEST
  rename. A crash at any point leaves the previous checkpoint valid.
- `snapshot.json` captures: session metadata, replay position and speed,
  global watermark, monotonic counters (projection_version, ws_sequence,
  playback_epoch), full operator state blobs (window aggregates, percentile
  sketches, temporal-join buffers + dedupe keys), and the deterministic
  evidence-id set at the cursor.
- Projections stay recompute-on-publish and are therefore idempotent; the
  evidence-id set in the checkpoint is a consistency check, not a replay log.
  Recovery verifies the recomputed set equals the checkpointed set.
- Recovery: read LATEST, validate manifest + checksums, fall back to older
  checkpoints when corrupt; restore incident from the recorded path, seek to
  the checkpointed cursor, restore operator state via `Operator::restore`,
  and never move `ws_sequence` backwards (client gap detection depends on
  monotonicity).
- The crash-test endpoint simulates process loss by discarding all in-memory
  session state, then runs the identical recovery path a process restart
  would use.

## Claim discipline

This is **checkpoint recovery with idempotent incident projections**. It is
not exactly-once and is never described as such.

## Consequences

- RocksDB (spec section 8) remains unnecessary at current state sizes;
  versioned JSON files with checksums are auditable and testable.
- The join operator's snapshot debt (metadata-only) is closed; all three
  stateful operators round-trip.
