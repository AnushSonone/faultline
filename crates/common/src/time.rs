//! Event-time model for Faultline telemetry.
//!
//! Four distinct clocks appear in the system. Only the first three may be stored
//! on a [`crate::event::TelemetryEnvelope`] as source-adjacent truth.
//!
//! ## `event_time`
//! When the event happened in the observed system (primary ordering key for
//! faithful replay). Stored as [`crate::event::TelemetryEnvelope::event_time_ns`].
//!
//! ## `observed_time`
//! When the telemetry collector observed the event, if known. May differ from
//! event time under delayed export. Stored as
//! [`crate::event::TelemetryEnvelope::observed_time_ns`].
//!
//! ## `ingest_time`
//! When `faultlined` accepted the event. Assigned at the ingest boundary; not
//! a property of the source system. Stored as
//! [`crate::event::TelemetryEnvelope::ingest_time_ns`].
//!
//! ## `processing_time`
//! The current backend wall/monotonic clock during operator execution. Used for
//! metrics and deadlines only — **never** store processing time as source truth
//! on the envelope or as a substitute for event time.

/// Nanoseconds since Unix epoch (signed to allow pre-epoch / relative fixtures).
pub type TimeNs = i64;

/// Field name constants for documentation and schema alignment.
pub mod field {
    pub const EVENT_TIME_NS: &str = "event_time_ns";
    pub const OBSERVED_TIME_NS: &str = "observed_time_ns";
    pub const INGEST_TIME_NS: &str = "ingest_time_ns";
    /// Not a stored envelope field; listed for completeness.
    pub const PROCESSING_TIME: &str = "processing_time";
}
