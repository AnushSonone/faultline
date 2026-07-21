//! Shared error type for Faultline crates.

use thiserror::Error;

/// Errors that can occur when constructing or validating common types.
#[derive(Debug, Error)]
pub enum FaultlineError {
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("invalid event: {0}")]
    InvalidEvent(String),

    #[error("schema version mismatch: expected {expected}, got {got}")]
    SchemaVersion { expected: u16, got: u16 },

    #[error("{0}")]
    Other(String),
}
