//! Projection DTOs and WebSocket protocol for visual replay.

pub mod heatmap;
pub mod protocol;
pub mod timeline;
pub mod topology;
pub mod trace;

pub use heatmap::{build_heatmap, HeatmapCell, HeatmapProjection};
pub use protocol::{WsEnvelope, PROTOCOL_VERSION};
pub use timeline::{build_timeline, TimelineEvent, TimelineProjection};
pub use topology::{build_topology, TopologyProjection};
pub use trace::{build_trace_projection, get_trace, TraceAvailable, TraceProjection};
