//! Deterministic event identity.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

use crate::event::TelemetrySignal;

/// Opaque event identifier. For replayed datasets this must be deterministic.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EventId(String);

impl EventId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for EventId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for EventId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for EventId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl AsRef<str> for EventId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Stable fields hashed into a deterministic [`EventId`].
///
/// Identity rule (spec §12): hash stable source fields plus dataset version so
/// replayed datasets produce the same `event_id` across runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeterministicIdFields<'a> {
    pub dataset_id: &'a str,
    pub dataset_version: &'a str,
    pub source_id: &'a str,
    pub event_time_ns: i64,
    pub signal: TelemetrySignal,
    /// Source-specific stable key (metric name, span_id, log line hash, etc.).
    pub stable_key: &'a str,
}

/// Compute a SHA-256 hex [`EventId`] from stable identity fields.
///
/// Fields are length-prefixed and concatenated so values cannot collide across
/// field boundaries.
pub fn deterministic_event_id(fields: &DeterministicIdFields<'_>) -> EventId {
    let mut hasher = Sha256::new();
    write_field(&mut hasher, fields.dataset_id.as_bytes());
    write_field(&mut hasher, fields.dataset_version.as_bytes());
    write_field(&mut hasher, fields.source_id.as_bytes());
    write_field(&mut hasher, &fields.event_time_ns.to_le_bytes());
    write_field(&mut hasher, signal_tag(fields.signal).as_bytes());
    write_field(&mut hasher, fields.stable_key.as_bytes());
    EventId(hex::encode(hasher.finalize()))
}

fn write_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

fn signal_tag(signal: TelemetrySignal) -> &'static str {
    match signal {
        TelemetrySignal::Metric => "metric",
        TelemetrySignal::Span => "span",
        TelemetrySignal::Log => "log",
        TelemetrySignal::Deployment => "deployment",
        TelemetrySignal::Configuration => "configuration",
        TelemetrySignal::Alert => "alert",
        TelemetrySignal::Annotation => "annotation",
        TelemetrySignal::Control => "control",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_fields() -> DeterministicIdFields<'static> {
        DeterministicIdFields {
            dataset_id: "rcaeval-re2-ob",
            dataset_version: "v1",
            source_id: "metrics.json",
            event_time_ns: 1_700_000_000_000_000_000,
            signal: TelemetrySignal::Metric,
            stable_key: "frontend|cpu_usage|gauge",
        }
    }

    #[test]
    fn event_id_is_stable_across_calls() {
        let a = deterministic_event_id(&sample_fields());
        let b = deterministic_event_id(&sample_fields());
        assert_eq!(a, b);
        assert_eq!(a.as_str().len(), 64);
    }

    #[test]
    fn event_id_changes_when_stable_field_changes() {
        let base = deterministic_event_id(&sample_fields());
        let mut changed = sample_fields();
        changed.stable_key = "frontend|cpu_usage|counter";
        let other = deterministic_event_id(&changed);
        assert_ne!(base, other);
    }

    #[test]
    fn event_id_json_round_trip() {
        let id = deterministic_event_id(&sample_fields());
        let json = serde_json::to_string(&id).unwrap();
        let back: EventId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, back);
    }
}
