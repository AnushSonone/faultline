//! Checkpoint document: everything a session needs to resume (spec 23).

use serde::{Deserialize, Serialize};

/// Operator snapshot mirror. Kept structurally identical to
/// `faultline_engine::OperatorSnapshot` without a crate dependency cycle:
/// the engine stays independent of the state crate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OperatorState {
    pub operator_id: String,
    pub watermark_ns: i64,
    pub state_bytes: usize,
    #[serde(with = "blob_base64")]
    pub blob: Vec<u8>,
}

mod blob_base64 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let raw = String::deserialize(d)?;
        hex::decode(&raw).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionMeta {
    pub session_id: String,
    pub incident_id: Option<String>,
    pub incident_path: Option<String>,
    pub adversarial: bool,
    pub adversarial_seed: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReplayPosition {
    pub start_ns: i64,
    pub end_ns: i64,
    pub cursor_ns: i64,
    pub state: String,
    pub speed: String,
}

/// The checkpointed state of one session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CheckpointDoc {
    pub schema_version: u16,
    pub checkpoint_id: String,
    pub session: SessionMeta,
    pub replay: ReplayPosition,
    /// Global watermark at checkpoint time.
    pub global_watermark_ns: i64,
    /// Monotonic counters so recovery never reuses sequence numbers.
    pub projection_version: u64,
    pub ws_sequence: u64,
    pub playback_epoch: u64,
    /// Stateful operator snapshots (window, percentile, temporal join).
    pub operators: Vec<OperatorState>,
    /// Deterministic evidence ids already emitted; recovery must not mint
    /// duplicates (idempotent projections make this a consistency check).
    pub emitted_evidence_ids: Vec<String>,
}
