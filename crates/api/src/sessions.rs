//! Investigation session state: replay envelopes, clock, ingest, projections.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use faultline_catalog::Labels;
use faultline_engine::{HeatmapStreamingPipeline, ProjectionMode, RuntimeInspectorDto};
use faultline_graph::TraceDag;
use faultline_ingest::{IngestPipeline, DEFAULT_CAPACITY};
use faultline_projection::{
    build_heatmap, build_timeline, build_topology, build_trace_projection, get_trace, WsEnvelope,
};
use faultline_replay::{load_incident, ClockState, ReplayClock, ReplaySpeed};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SessionId(pub String);

impl SessionId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateSessionResponse {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct LoadRequest {
    #[serde(default)]
    pub incident_path: Option<String>,
    #[serde(default)]
    pub incident_id: Option<String>,
    /// When true, metric arrival order is adversarially shuffled (seeded).
    #[serde(default)]
    pub adversarial: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SeekRequest {
    pub event_time_ns: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SpeedRequest {
    pub speed: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ProjectionModeRequest {
    pub mode: String,
}

pub struct Session {
    pub id: String,
    pub envelopes: Vec<faultline_common::TelemetryEnvelope>,
    pub clock: ReplayClock,
    pub ingest: IngestPipeline,
    pub incident_id: Option<String>,
    pub incident_path: Option<PathBuf>,
    pub labels: Option<Labels>,
    pub projection_version: u64,
    pub ws_sequence: u64,
    /// Bumped on each play request so only one tick loop remains active.
    pub playback_epoch: u64,
    pub broadcast: broadcast::Sender<WsEnvelope>,
    pub heatmap_pipeline: HeatmapStreamingPipeline,
    pub adversarial: bool,
    pub adversarial_seed: u64,
}

impl Session {
    pub fn new(id: String) -> Self {
        let (broadcast, _) = broadcast::channel(256);
        Self {
            id,
            envelopes: Vec::new(),
            clock: ReplayClock::new(0, 0),
            ingest: IngestPipeline::new(DEFAULT_CAPACITY),
            incident_id: None,
            incident_path: None,
            labels: None,
            projection_version: 0,
            ws_sequence: 0,
            playback_epoch: 0,
            broadcast,
            // Default heatmap to streaming after M3 core parity on synthetic fixture.
            heatmap_pipeline: HeatmapStreamingPipeline::new(ProjectionMode::Streaming),
            adversarial: false,
            adversarial_seed: 42,
        }
    }

    pub fn load_from_path(&mut self, path: &Path, adversarial: bool) -> Result<(), String> {
        let loaded = load_incident(path).map_err(|e| e.to_string())?;
        let start = loaded.manifest.start_time_ns;
        let end = loaded.manifest.end_time_ns;
        self.incident_id = Some(loaded.manifest.incident_id.clone());
        self.incident_path = Some(loaded.dir.clone());
        self.labels = Some(loaded.labels);
        self.envelopes = loaded.envelopes;
        self.adversarial = adversarial;
        self.clock = ReplayClock::new(start, end);
        let cap = self.envelopes.len().max(DEFAULT_CAPACITY);
        self.ingest = IngestPipeline::new(cap);
        // Keep receiver alive so try_ingest does not see a closed channel.
        self.projection_version = 0;
        self.ws_sequence = 0;
        self.playback_epoch = self.playback_epoch.saturating_add(1);
        self.heatmap_pipeline.reset();

        for env in &self.envelopes {
            self.ingest
                .try_ingest(env.clone())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsEnvelope> {
        self.broadcast.subscribe()
    }

    fn next_seq(&mut self) -> u64 {
        self.ws_sequence = self.ws_sequence.saturating_add(1);
        self.ws_sequence
    }

    pub fn emit(&mut self, message_type: &str, payload: serde_json::Value) {
        let seq = self.next_seq();
        let env = WsEnvelope::new(
            self.id.clone(),
            seq,
            0,
            self.clock.current_event_time_ns(),
            message_type,
            payload,
        );
        let _ = self.broadcast.send(env);
    }

    pub fn publish_projections(&mut self) {
        self.projection_version = self.projection_version.saturating_add(1);
        let cursor = self.clock.current_event_time_ns();
        let ver = self.projection_version;

        let topology = build_topology(&self.envelopes, cursor, ver);
        let timeline = build_timeline(&self.envelopes, cursor, ver);
        let heatmap = self.build_heatmap(cursor, ver);
        let traces = build_trace_projection(&self.envelopes, cursor, ver);
        let mode = self.heatmap_pipeline.mode();

        self.emit(
            "replay.status",
            json!({
                "state": format!("{:?}", self.clock.state()).to_ascii_lowercase(),
                "speed": format!("{:?}", self.clock.speed()),
                "event_time_ns": cursor,
                "heatmap_mode": format!("{mode:?}").to_ascii_lowercase(),
            }),
        );
        self.emit("clock.tick", json!({ "event_time_ns": cursor }));
        self.emit(
            "topology.snapshot",
            serde_json::to_value(&topology).unwrap_or(json!({})),
        );
        self.emit(
            "timeline.append",
            serde_json::to_value(&timeline).unwrap_or(json!({})),
        );
        self.emit(
            "heatmap.delta",
            serde_json::to_value(&heatmap).unwrap_or(json!({})),
        );
        self.emit(
            "trace.available",
            serde_json::to_value(&traces).unwrap_or(json!({})),
        );
        let inspector = self.heatmap_pipeline.inspector();
        self.emit(
            "runtime.inspector",
            serde_json::to_value(&inspector).unwrap_or(json!({})),
        );
    }

    fn build_heatmap(&mut self, cursor: i64, ver: u64) -> faultline_projection::HeatmapProjection {
        match self.heatmap_pipeline.mode() {
            ProjectionMode::Precomputed => {
                build_heatmap(&self.envelopes, cursor, 1_000_000_000, ver)
            }
            ProjectionMode::Streaming => {
                let result = if self.adversarial {
                    let filtered: Vec<_> = self
                        .envelopes
                        .iter()
                        .filter(|e| e.event_time_ns <= cursor)
                        .cloned()
                        .collect();
                    let arrival = HeatmapStreamingPipeline::adversarial_arrival_order(
                        &filtered,
                        self.adversarial_seed,
                    );
                    self.heatmap_pipeline
                        .rebuild_arrival_order(&arrival, cursor)
                } else {
                    self.heatmap_pipeline.rebuild_until(&self.envelopes, cursor)
                };
                match result {
                    Ok(mut heat) => {
                        heat.projection_version = ver;
                        heat
                    }
                    Err(e) => {
                        tracing::warn!("streaming heatmap failed, falling back: {e}");
                        build_heatmap(&self.envelopes, cursor, 1_000_000_000, ver)
                    }
                }
            }
        }
    }

    pub fn set_projection_mode(&mut self, mode: ProjectionMode) {
        self.heatmap_pipeline.set_mode(mode);
        self.heatmap_pipeline.reset();
    }

    pub fn inspector(&self) -> RuntimeInspectorDto {
        self.heatmap_pipeline.inspector()
    }

    pub fn get_trace(&self, trace_id: &str) -> Option<TraceDag> {
        // Cursor-bounded so seek-back cannot retain later spans.
        get_trace(
            &self.envelopes,
            trace_id,
            self.clock.current_event_time_ns(),
        )
    }

    pub fn reset_replay(&mut self) {
        self.playback_epoch = self.playback_epoch.saturating_add(1);
        self.clock.reset();
        self.heatmap_pipeline.reset();
        self.publish_projections();
    }
}

pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    pub fixtures_root: PathBuf,
}

impl AppState {
    pub fn new(fixtures_root: impl Into<PathBuf>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            fixtures_root: fixtures_root.into(),
        }
    }

    pub fn create_session(&self) -> String {
        let id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .insert(id.clone(), Session::new(id.clone()));
        id
    }

    pub fn resolve_incident_path(&self, req: &LoadRequest) -> Result<PathBuf, String> {
        if let Some(path) = &req.incident_path {
            let p = PathBuf::from(path);
            if p.exists() {
                return Ok(p);
            }
            return Err(format!("incident_path not found: {path}"));
        }
        if let Some(id) = &req.incident_id {
            // Prefer synthetic fixture layout: synthetic-ob/v1/<id>
            let candidate = self.fixtures_root.join("synthetic-ob").join("v1").join(id);
            if candidate.exists() {
                return Ok(candidate);
            }
            // Also try fixtures_root/<id>
            let direct = self.fixtures_root.join(id);
            if direct.exists() {
                return Ok(direct);
            }
            return Err(format!("incident_id not found: {id}"));
        }
        Err("incident_path or incident_id required".into())
    }
}

pub fn parse_speed(s: &str) -> Result<ReplaySpeed, String> {
    ReplaySpeed::parse(s).ok_or_else(|| format!("invalid speed: {s}"))
}

pub fn clock_state_label(state: ClockState) -> &'static str {
    match state {
        ClockState::Stopped => "stopped",
        ClockState::Playing => "playing",
        ClockState::Paused => "paused",
    }
}

pub type SharedState = Arc<AppState>;
