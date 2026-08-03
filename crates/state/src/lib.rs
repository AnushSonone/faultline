//! Faultline state crate: versioned checkpoints with atomic writes and
//! checksummed recovery (TA-039..041, spec 23).
//!
//! Claim discipline: this is checkpoint recovery with idempotent incident
//! projections - never "exactly-once".

pub mod checksum;
pub mod manifest;
pub mod recovery;
pub mod snapshot;
pub mod store;

#[cfg(test)]
mod tests;

pub use manifest::{CheckpointFile, CheckpointManifest, CHECKPOINT_SCHEMA_VERSION};
pub use recovery::{recover_latest, RecoveryOutcome};
pub use snapshot::{CheckpointDoc, OperatorState, ReplayPosition, SessionMeta};
pub use store::{CheckpointMetrics, CheckpointStore};
