//! Recovery (spec 23): read LATEST, validate manifest + checksums, fall back
//! to older checkpoints when the newest is corrupt.

use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::checksum::sha256_file;
use crate::manifest::CheckpointManifest;
use crate::snapshot::CheckpointDoc;
use crate::store::{CheckpointStore, MANIFEST_FILE, SNAPSHOT_FILE};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoveryOutcome {
    pub doc: CheckpointDoc,
    /// True when LATEST (or a newer checkpoint) was corrupt and an older one
    /// was used.
    pub fell_back: bool,
    pub recovery_duration_seconds: f64,
    /// Checkpoints that failed validation, newest first.
    pub rejected: Vec<String>,
}

/// Attempt recovery from the newest valid checkpoint.
pub fn recover_latest(store: &CheckpointStore) -> Result<RecoveryOutcome, String> {
    let started = Instant::now();
    let mut candidates: Vec<String> = Vec::new();
    if let Some(latest) = store.latest_pointer() {
        candidates.push(latest);
    }
    for id in store.list_ids() {
        if !candidates.contains(&id) {
            candidates.push(id);
        }
    }
    if candidates.is_empty() {
        return Err("no checkpoints found".into());
    }

    let mut rejected = Vec::new();
    for (i, id) in candidates.iter().enumerate() {
        match load_validated(store, id) {
            Ok(doc) => {
                return Ok(RecoveryOutcome {
                    doc,
                    fell_back: i > 0,
                    recovery_duration_seconds: started.elapsed().as_secs_f64(),
                    rejected,
                });
            }
            Err(e) => rejected.push(format!("{id}: {e}")),
        }
    }
    Err(format!(
        "all checkpoints failed validation: {}",
        rejected.join("; ")
    ))
}

fn load_validated(store: &CheckpointStore, checkpoint_id: &str) -> Result<CheckpointDoc, String> {
    let dir = store.checkpoint_dir(checkpoint_id);
    let manifest_raw = std::fs::read_to_string(dir.join(MANIFEST_FILE))
        .map_err(|e| format!("manifest read: {e}"))?;
    let manifest: CheckpointManifest =
        serde_json::from_str(&manifest_raw).map_err(|e| format!("manifest parse: {e}"))?;
    if manifest.checkpoint_id != checkpoint_id {
        return Err(format!(
            "manifest id mismatch: {} != {checkpoint_id}",
            manifest.checkpoint_id
        ));
    }
    for file in &manifest.files {
        let path = dir.join(&file.path);
        let actual = sha256_file(&path).map_err(|e| format!("{}: {e}", file.path))?;
        if actual != file.sha256 {
            return Err(format!("checksum mismatch on {}", file.path));
        }
    }
    let doc_raw = std::fs::read_to_string(dir.join(SNAPSHOT_FILE))
        .map_err(|e| format!("snapshot read: {e}"))?;
    serde_json::from_str(&doc_raw).map_err(|e| format!("snapshot parse: {e}"))
}
