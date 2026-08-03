//! Checkpoint manifest: written LAST, after all files and checksums.

use serde::{Deserialize, Serialize};

pub const CHECKPOINT_SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CheckpointFile {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CheckpointManifest {
    pub schema_version: u16,
    pub checkpoint_id: String,
    pub session_id: String,
    pub cursor_ns: i64,
    pub files: Vec<CheckpointFile>,
}
