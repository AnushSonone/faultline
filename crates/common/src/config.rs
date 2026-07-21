//! Minimal shared configuration constants and types.

use serde::{Deserialize, Serialize};

/// Current canonical envelope schema version.
pub const SCHEMA_VERSION: u16 = 1;

/// Placeholder for crate-level defaults shared across Faultline components.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommonConfig {
    pub schema_version: u16,
}

impl Default for CommonConfig {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
        }
    }
}
