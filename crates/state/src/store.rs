//! Atomic checkpoint writes (spec 23 sequence):
//! temp dir -> flush files -> compute checksums -> manifest LAST ->
//! atomic dir rename -> atomic LATEST pointer update.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::checksum::sha256_bytes;
use crate::manifest::{CheckpointFile, CheckpointManifest, CHECKPOINT_SCHEMA_VERSION};
use crate::snapshot::CheckpointDoc;

pub const SNAPSHOT_FILE: &str = "snapshot.json";
pub const MANIFEST_FILE: &str = "manifest.json";
pub const LATEST_FILE: &str = "LATEST";

/// Observability per spec 24: checkpoint_duration_seconds, checkpoint_bytes.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CheckpointMetrics {
    pub checkpoint_id: String,
    pub checkpoint_duration_seconds: f64,
    pub checkpoint_bytes: u64,
    pub path: String,
}

/// Directory-per-checkpoint store rooted at one session's checkpoint root.
pub struct CheckpointStore {
    root: PathBuf,
}

impl CheckpointStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Write a checkpoint atomically. Returns metrics on success.
    pub fn write(&self, doc: &CheckpointDoc) -> Result<CheckpointMetrics, String> {
        let started = Instant::now();
        fs::create_dir_all(&self.root).map_err(|e| format!("mkdir root: {e}"))?;

        // 1. Temp dir.
        let tmp = self.root.join(format!(".tmp-{}", doc.checkpoint_id));
        if tmp.exists() {
            fs::remove_dir_all(&tmp).map_err(|e| format!("clear tmp: {e}"))?;
        }
        fs::create_dir_all(&tmp).map_err(|e| format!("mkdir tmp: {e}"))?;

        // 2. Flush state files.
        let snapshot_bytes =
            serde_json::to_vec_pretty(doc).map_err(|e| format!("serialize snapshot: {e}"))?;
        write_flushed(&tmp.join(SNAPSHOT_FILE), &snapshot_bytes)?;

        // 3. Checksums, then 4. manifest LAST.
        let manifest = CheckpointManifest {
            schema_version: CHECKPOINT_SCHEMA_VERSION,
            checkpoint_id: doc.checkpoint_id.clone(),
            session_id: doc.session.session_id.clone(),
            cursor_ns: doc.replay.cursor_ns,
            files: vec![CheckpointFile {
                path: SNAPSHOT_FILE.into(),
                sha256: sha256_bytes(&snapshot_bytes),
                bytes: snapshot_bytes.len() as u64,
            }],
        };
        let manifest_bytes =
            serde_json::to_vec_pretty(&manifest).map_err(|e| format!("serialize manifest: {e}"))?;
        write_flushed(&tmp.join(MANIFEST_FILE), &manifest_bytes)?;

        // 5. Atomic rename of the directory.
        let final_dir = self.checkpoint_dir(&doc.checkpoint_id);
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir).map_err(|e| format!("clear final: {e}"))?;
        }
        fs::rename(&tmp, &final_dir).map_err(|e| format!("rename dir: {e}"))?;

        // 6. Atomic LATEST pointer update (write tmp file, rename).
        let latest_tmp = self.root.join(".LATEST.tmp");
        write_flushed(&latest_tmp, doc.checkpoint_id.as_bytes())?;
        fs::rename(&latest_tmp, self.root.join(LATEST_FILE))
            .map_err(|e| format!("rename LATEST: {e}"))?;

        let total_bytes = (snapshot_bytes.len() + manifest_bytes.len()) as u64;
        Ok(CheckpointMetrics {
            checkpoint_id: doc.checkpoint_id.clone(),
            checkpoint_duration_seconds: started.elapsed().as_secs_f64(),
            checkpoint_bytes: total_bytes,
            path: final_dir.display().to_string(),
        })
    }

    pub fn checkpoint_dir(&self, checkpoint_id: &str) -> PathBuf {
        self.root.join(format!("cp-{checkpoint_id}"))
    }

    /// Checkpoint ids present on disk, newest first (ids sort by creation
    /// order because callers use zero-padded monotonic ids).
    pub fn list_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = fs::read_dir(&self.root)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| {
                        e.file_name()
                            .to_str()
                            .and_then(|n| n.strip_prefix("cp-"))
                            .map(str::to_owned)
                    })
                    .collect()
            })
            .unwrap_or_default();
        ids.sort();
        ids.reverse();
        ids
    }

    pub fn latest_pointer(&self) -> Option<String> {
        fs::read_to_string(self.root.join(LATEST_FILE))
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
    }
}

fn write_flushed(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut f = fs::File::create(path).map_err(|e| format!("create {}: {e}", path.display()))?;
    f.write_all(bytes)
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    f.sync_all()
        .map_err(|e| format!("sync {}: {e}", path.display()))?;
    Ok(())
}
