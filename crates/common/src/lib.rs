//! Faultline shared types: canonical telemetry envelopes, IDs, time model, errors.

pub mod config;
pub mod error;
pub mod event;
pub mod ids;
pub mod time;

pub use config::{CommonConfig, SCHEMA_VERSION};
pub use error::FaultlineError;
pub use event::*;
pub use ids::{deterministic_event_id, DeterministicIdFields, EventId};
pub use time::TimeNs;
