//! Investigation session state: replay envelopes, clock, ingest, projections.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use faultline_catalog::{Labels, Manifest};
use faultline_engine::{HeatmapStreamingPipeline, ProjectionMode, RuntimeInspectorDto};
use faultline_ingest::{IngestPipeline, DEFAULT_CAPACITY};
use faultline_projection::{
    build_correlation_precomputed, build_heatmap, build_inference_projections, build_root_causes,
    build_timeline, build_topology, build_trace_detail, build_trace_projection, WsEnvelope,
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
    /// When true, fixture ground-truth labels are included in the load
    /// response. Hidden by default (spec M4 exit criterion).
    #[serde(default)]
    pub evaluation_mode: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SeekRequest {
    pub event_time_ns: i64,
}

/// Query params for the case-metadata endpoint. `reveal` opts in to the
/// ground-truth answer fields, mirroring the `evaluation_mode` gate on load.
#[derive(Clone, Debug, Deserialize)]
pub struct CaseQuery {
    #[serde(default)]
    pub reveal: bool,
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
    pub manifest: Option<Manifest>,
    pub projection_version: u64,
    pub ws_sequence: u64,
    /// Bumped on each play request so only one tick loop remains active.
    pub playback_epoch: u64,
    pub broadcast: broadcast::Sender<WsEnvelope>,
    pub heatmap_pipeline: HeatmapStreamingPipeline,
    pub adversarial: bool,
    pub adversarial_seed: u64,
    pub last_checkpoint: Option<faultline_state::CheckpointMetrics>,
    /// Last time a client touched this session. Idle sessions past the
    /// configured TTL are evicted (demo hygiene).
    pub last_activity: Instant,
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
            manifest: None,
            projection_version: 0,
            ws_sequence: 0,
            playback_epoch: 0,
            broadcast,
            // Default heatmap to streaming after M3 core parity on synthetic fixture.
            heatmap_pipeline: HeatmapStreamingPipeline::new(ProjectionMode::Streaming),
            adversarial: false,
            adversarial_seed: 42,
            last_checkpoint: None,
            last_activity: Instant::now(),
        }
    }

    /// Mark the session as active now. Called on every client interaction so
    /// idle-TTL eviction only reaps abandoned sessions.
    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Above this event count the streaming heatmap's from-scratch arrival
    /// replay (M3 known issue: rebuild is not incremental) takes tens of
    /// seconds per publish under the sessions lock, so large incidents load
    /// in precomputed mode. The guided synthetic cases stay streaming.
    pub const STREAMING_HEATMAP_MAX_EVENTS: usize = 20_000;

    pub fn load_from_path(&mut self, path: &Path, adversarial: bool) -> Result<(), String> {
        let loaded = load_incident(path).map_err(|e| e.to_string())?;
        let start = loaded.manifest.start_time_ns;
        let end = loaded.manifest.end_time_ns;
        self.incident_id = Some(loaded.manifest.incident_id.clone());
        self.incident_path = Some(loaded.dir.clone());
        self.labels = Some(loaded.labels);
        self.manifest = Some(loaded.manifest.clone());
        self.envelopes = loaded.envelopes;
        self.adversarial = adversarial;
        self.clock = ReplayClock::new(start, end);
        let cap = self.envelopes.len().max(DEFAULT_CAPACITY);
        self.ingest = IngestPipeline::new(cap);
        // Keep receiver alive so try_ingest does not see a closed channel.
        self.projection_version = 0;
        self.ws_sequence = 0;
        self.playback_epoch = self.playback_epoch.saturating_add(1);
        if self.envelopes.len() > Self::STREAMING_HEATMAP_MAX_EVENTS {
            self.heatmap_pipeline.set_mode(ProjectionMode::Precomputed);
        } else {
            self.heatmap_pipeline.set_mode(ProjectionMode::Streaming);
        }
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
        let replay_state = format!("{:?}", self.clock.state()).to_ascii_lowercase();
        let replay_speed = format!("{:?}", self.clock.speed());
        self.heatmap_pipeline.set_session_meta(
            &replay_state,
            &replay_speed,
            ver,
            self.broadcast.receiver_count(),
            0,
            0,
        );

        self.emit(
            "replay.status",
            json!({
                "state": replay_state,
                "speed": replay_speed,
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
        let correlation = match mode {
            ProjectionMode::Streaming => self
                .heatmap_pipeline
                .last_correlation()
                .cloned()
                .unwrap_or_else(|| build_correlation_precomputed(&self.envelopes, cursor, ver)),
            ProjectionMode::Precomputed => {
                build_correlation_precomputed(&self.envelopes, cursor, ver)
            }
        };
        self.emit(
            "correlation.snapshot",
            serde_json::to_value(&correlation).unwrap_or(json!({})),
        );
        let incident_id = self.incident_id.clone().unwrap_or_default();
        let (root_causes, evidence_graph) =
            build_inference_projections(&incident_id, &self.envelopes, cursor, ver);
        self.emit(
            "root_causes.snapshot",
            serde_json::to_value(&root_causes).unwrap_or(json!({})),
        );
        self.emit(
            "evidence.updated",
            serde_json::to_value(&evidence_graph).unwrap_or(json!({})),
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

    pub fn inspector(&mut self) -> RuntimeInspectorDto {
        self.heatmap_pipeline.inspector()
    }

    pub fn get_trace(&self, trace_id: &str) -> Option<faultline_projection::TraceDetail> {
        // Cursor-bounded so seek-back cannot retain later spans. Incident
        // onset scopes the healthy cohort to pre-incident traces.
        let cursor = self.clock.current_event_time_ns();
        let incident_id = self.incident_id.clone().unwrap_or_default();
        let onset = build_root_causes(&incident_id, &self.envelopes, cursor, 0).incident_onset_ns;
        build_trace_detail(&self.envelopes, trace_id, cursor, onset)
    }

    pub fn reset_replay(&mut self) {
        self.playback_epoch = self.playback_epoch.saturating_add(1);
        self.clock.reset();
        self.heatmap_pipeline.reset();
        self.publish_projections();
    }

    /// Deterministic evidence ids at the current cursor. Used for the
    /// no-duplicate-after-recovery guarantee.
    fn evidence_ids_at_cursor(&self) -> Vec<String> {
        let cursor = self.clock.current_event_time_ns();
        let incident_id = self.incident_id.clone().unwrap_or_default();
        let mut ids: Vec<String> = build_root_causes(&incident_id, &self.envelopes, cursor, 0)
            .evidence
            .into_iter()
            .map(|e| e.evidence_id)
            .collect();
        ids.sort();
        ids
    }

    /// Write an atomic checkpoint (TA-040). Emits checkpoint.started /
    /// checkpoint.completed on the session stream.
    pub fn checkpoint(
        &mut self,
        store: &faultline_state::CheckpointStore,
    ) -> Result<faultline_state::CheckpointMetrics, String> {
        let next = store
            .list_ids()
            .first()
            .and_then(|id| id.parse::<u64>().ok())
            .unwrap_or(0)
            + 1;
        let checkpoint_id = format!("{next:06}");
        self.emit(
            "checkpoint.started",
            json!({ "checkpoint_id": checkpoint_id }),
        );

        let doc = faultline_state::CheckpointDoc {
            schema_version: faultline_state::CHECKPOINT_SCHEMA_VERSION,
            checkpoint_id: checkpoint_id.clone(),
            session: faultline_state::SessionMeta {
                session_id: self.id.clone(),
                incident_id: self.incident_id.clone(),
                incident_path: self.incident_path.as_ref().map(|p| p.display().to_string()),
                adversarial: self.adversarial,
                adversarial_seed: self.adversarial_seed,
            },
            replay: faultline_state::ReplayPosition {
                start_ns: self.clock.start_ns(),
                end_ns: self.clock.end_ns(),
                cursor_ns: self.clock.current_event_time_ns(),
                state: clock_state_label(self.clock.state()).to_owned(),
                speed: format!("{:?}", self.clock.speed()),
            },
            global_watermark_ns: self.clock.current_event_time_ns(),
            projection_version: self.projection_version,
            ws_sequence: self.ws_sequence,
            playback_epoch: self.playback_epoch,
            operators: self
                .heatmap_pipeline
                .snapshot_operators()
                .into_iter()
                .map(|s| faultline_state::OperatorState {
                    operator_id: s.operator_id,
                    watermark_ns: s.watermark_ns,
                    state_bytes: s.state_bytes,
                    blob: s.blob,
                })
                .collect(),
            emitted_evidence_ids: self.evidence_ids_at_cursor(),
        };
        let metrics = store.write(&doc)?;
        self.last_checkpoint = Some(metrics.clone());
        self.emit(
            "checkpoint.completed",
            serde_json::to_value(&metrics).unwrap_or(json!({})),
        );
        Ok(metrics)
    }

    /// Crash-test (TA-042): simulate loss of all in-memory session state,
    /// then run the real recovery path from disk. Returns a report proving
    /// no duplicate evidence was minted.
    pub fn crash_and_recover(
        &mut self,
        store: &faultline_state::CheckpointStore,
    ) -> Result<serde_json::Value, String> {
        // Ensure a checkpoint exists; take one if the store is empty.
        if store.list_ids().is_empty() {
            self.checkpoint(store)?;
        }
        self.emit(
            "engine.warning",
            json!({ "message": "crash test: discarding in-memory session state" }),
        );

        // Simulated crash: drop everything recomputable.
        self.envelopes.clear();
        self.clock = ReplayClock::new(0, 0);
        self.heatmap_pipeline.reset();
        self.playback_epoch = self.playback_epoch.saturating_add(1);
        let pre_recovery_sequence = self.ws_sequence;

        self.emit("recovery.started", json!({}));
        let outcome = faultline_state::recover_latest(store)?;
        let doc = &outcome.doc;

        // Restore source data + replay position.
        let path = doc
            .session
            .incident_path
            .as_ref()
            .ok_or("checkpoint lacks incident_path")?;
        self.load_from_path(Path::new(path), doc.session.adversarial)?;
        self.clock.seek(doc.replay.cursor_ns);
        self.clock.pause();

        // Restore operator state through the real snapshot contract.
        let snapshots: Vec<faultline_engine::OperatorSnapshot> = doc
            .operators
            .iter()
            .map(|s| faultline_engine::OperatorSnapshot {
                operator_id: s.operator_id.clone(),
                watermark_ns: s.watermark_ns,
                state_bytes: s.state_bytes,
                blob: s.blob.clone(),
            })
            .collect();
        self.heatmap_pipeline.restore_operators(&snapshots)?;

        // Counters: never move sequences backwards (WS gap detection relies
        // on monotonicity); projection_version resumes from the checkpoint.
        self.projection_version = doc.projection_version;
        self.ws_sequence = self
            .ws_sequence
            .max(pre_recovery_sequence)
            .max(doc.ws_sequence);

        // Idempotence check: deterministic evidence ids after recovery must
        // equal the checkpointed set - nothing duplicated, nothing invented.
        let after = self.evidence_ids_at_cursor();
        let mut expected = doc.emitted_evidence_ids.clone();
        expected.sort();
        let duplicates_after_recovery = after.len() != expected.len() || after != expected;

        self.publish_projections();
        let report = json!({
            "recovered_checkpoint_id": doc.checkpoint_id,
            "fell_back": outcome.fell_back,
            "recovery_duration_seconds": outcome.recovery_duration_seconds,
            "cursor_ns": doc.replay.cursor_ns,
            "duplicates_after_recovery": duplicates_after_recovery,
            "evidence_id_count": after.len(),
            "rejected": outcome.rejected,
        });
        self.emit("recovery.completed", report.clone());
        Ok(report)
    }
}

/// Default cap on concurrent sessions before create returns demo_busy.
pub const DEFAULT_MAX_SESSIONS: usize = 24;
/// Default idle TTL after which a session is evicted.
pub const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(900);

pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    pub fixtures_root: PathBuf,
    /// Root directory for per-session checkpoint stores.
    pub checkpoints_root: PathBuf,
    /// Registered SQL queries (TA-047).
    pub queries: Mutex<Vec<serde_json::Value>>,
    /// Maximum concurrent sessions. Creates past this cap return demo_busy.
    pub max_sessions: usize,
    /// Sessions idle longer than this are evicted.
    pub session_ttl: Duration,
    /// When Some, only these incident ids may be listed or loaded, and loads
    /// by explicit `incident_path` are rejected. None allows everything.
    pub allowed_incidents: Option<HashSet<String>>,
}

impl AppState {
    pub fn new(fixtures_root: impl Into<PathBuf>) -> Self {
        let checkpoints_root = std::env::var("FAULTLINE_CHECKPOINTS")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(".faultline-checkpoints"));
        Self::with_roots(fixtures_root, checkpoints_root)
    }

    /// Constructor with an explicit checkpoint root (tests, embedding).
    pub fn with_roots(
        fixtures_root: impl Into<PathBuf>,
        checkpoints_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            fixtures_root: fixtures_root.into(),
            checkpoints_root: checkpoints_root.into(),
            queries: Mutex::new(Vec::new()),
            max_sessions: DEFAULT_MAX_SESSIONS,
            session_ttl: DEFAULT_SESSION_TTL,
            allowed_incidents: None,
        }
    }

    /// Builder-style override for session capacity and idle TTL.
    pub fn with_limits(mut self, max_sessions: usize, session_ttl: Duration) -> Self {
        self.max_sessions = max_sessions;
        self.session_ttl = session_ttl;
        self
    }

    /// Builder-style incident allowlist. An empty iterator allows nothing.
    pub fn with_allowed_incidents<I, S>(mut self, allowed: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.allowed_incidents = Some(allowed.into_iter().map(Into::into).collect());
        self
    }

    /// Constructor for the daemon: applies `FAULTLINE_MAX_SESSIONS`,
    /// `FAULTLINE_SESSION_TTL_S`, and `FAULTLINE_ALLOWED_INCIDENTS`
    /// (comma-separated ids) on top of the defaults.
    pub fn from_env(fixtures_root: impl Into<PathBuf>) -> Self {
        let mut state = Self::new(fixtures_root);
        if let Ok(raw) = std::env::var("FAULTLINE_MAX_SESSIONS") {
            match raw.trim().parse::<usize>() {
                Ok(n) => state.max_sessions = n,
                Err(_) => tracing::warn!("ignoring invalid FAULTLINE_MAX_SESSIONS: {raw}"),
            }
        }
        if let Ok(raw) = std::env::var("FAULTLINE_SESSION_TTL_S") {
            match raw.trim().parse::<u64>() {
                Ok(secs) => state.session_ttl = Duration::from_secs(secs),
                Err(_) => tracing::warn!("ignoring invalid FAULTLINE_SESSION_TTL_S: {raw}"),
            }
        }
        if let Ok(raw) = std::env::var("FAULTLINE_ALLOWED_INCIDENTS") {
            let set: HashSet<String> = raw
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();
            if set.is_empty() {
                tracing::warn!("FAULTLINE_ALLOWED_INCIDENTS set but empty, allowing all");
            } else {
                state.allowed_incidents = Some(set);
            }
        }
        state
    }

    pub fn checkpoint_store(&self, session_id: &str) -> faultline_state::CheckpointStore {
        faultline_state::CheckpointStore::new(self.checkpoints_root.join(session_id))
    }

    /// Evict idle sessions, then create a new one. Returns None when the
    /// session cap is reached (the route maps this to 503 demo_busy).
    pub fn create_session(&self) -> Option<String> {
        let mut sessions = self.sessions.lock();
        Self::retain_live(&mut sessions, self.session_ttl);
        if sessions.len() >= self.max_sessions {
            return None;
        }
        let id = Uuid::new_v4().to_string();
        sessions.insert(id.clone(), Session::new(id.clone()));
        Some(id)
    }

    /// Grace period for orphaned sessions: no WebSocket subscriber and idle
    /// past this bound. Closed browser tabs free their slot in about a
    /// minute instead of holding it for the full TTL.
    const ORPHAN_GRACE: Duration = Duration::from_secs(60);

    fn retain_live(sessions: &mut HashMap<String, Session>, ttl: Duration) {
        sessions.retain(|_, s| {
            let idle = s.last_activity.elapsed();
            if idle > ttl {
                return false;
            }
            let orphaned = s.broadcast.receiver_count() == 0;
            !(orphaned && idle > Self::ORPHAN_GRACE)
        });
    }

    /// Remove sessions idle past the TTL, plus orphaned sessions (no WS
    /// subscribers) past a short grace. Returns how many were evicted.
    /// Safe against in-flight playback: tick loops look their session up by
    /// id each tick and exit when it is gone.
    pub fn evict_idle(&self) -> usize {
        let mut sessions = self.sessions.lock();
        let before = sessions.len();
        Self::retain_live(&mut sessions, self.session_ttl);
        before - sessions.len()
    }

    /// Whether an incident id passes the allowlist (always true when no
    /// allowlist is configured).
    pub fn incident_allowed(&self, incident_id: &str) -> bool {
        self.allowed_incidents
            .as_ref()
            .is_none_or(|allowed| allowed.contains(incident_id))
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
            return faultline_catalog::discover_incidents(&self.fixtures_root)
                .into_iter()
                .find(|i| &i.incident_id == id)
                .map(|i| i.path)
                .ok_or_else(|| format!("incident_id not found: {id}"));
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
