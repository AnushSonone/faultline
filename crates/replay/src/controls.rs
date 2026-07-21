//! Replay control commands.

use crate::clock::ReplaySpeed;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Control-plane commands for the replay service.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReplayCommand {
    Load {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        incident_path: Option<PathBuf>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        incident_id: Option<String>,
    },
    Play,
    Pause,
    Resume,
    Seek {
        event_time_ns: i64,
    },
    Stop,
    Reset,
    SetSpeed {
        speed: ReplaySpeed,
    },
}
