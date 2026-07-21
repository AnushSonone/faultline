//! Versioned WebSocket envelope (spec §22).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 1;

/// Wire envelope for session streams.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WsEnvelope {
    pub protocol_version: u16,
    pub session_id: String,
    pub sequence: u64,
    pub server_time_ns: i64,
    pub event_time_ns: i64,
    #[serde(rename = "type")]
    pub message_type: String,
    pub payload: Value,
}

impl WsEnvelope {
    pub fn new(
        session_id: impl Into<String>,
        sequence: u64,
        server_time_ns: i64,
        event_time_ns: i64,
        message_type: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            session_id: session_id.into(),
            sequence,
            server_time_ns,
            event_time_ns,
            message_type: message_type.into(),
            payload,
        }
    }
}
