//! Streaming approximate percentiles via DDSketch (TA-026).

use std::collections::BTreeMap;
use std::sync::Arc;

use arrow::array::{Array, Float64Array, Float64Builder, Int64Array, Int64Builder, StringArray, StringBuilder, UInt64Builder};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use serde::{Deserialize, Serialize};
use sketches_ddsketch::{Config, DDSketch};

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics, OperatorSnapshot};
use crate::operators::window::WindowKind;

/// Relative accuracy α for DDSketch. Contract: relative error ≤ 2α for positive values.
pub const DEFAULT_SKETCH_ALPHA: f64 = 0.01;

/// Acceptable relative error bound for UI use of p50/p95/p99 (documented contract).
pub const ACCEPTABLE_RELATIVE_ERROR: f64 = 0.02;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PercentileKind {
    P50,
    P95,
    P99,
}

impl PercentileKind {
    pub fn quantile(self) -> f64 {
        match self {
            Self::P50 => 0.50,
            Self::P95 => 0.95,
            Self::P99 => 0.99,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::P50 => "p50",
            Self::P95 => "p95",
            Self::P99 => "p99",
        }
    }

    pub fn all() -> [Self; 3] {
        [Self::P50, Self::P95, Self::P99]
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PercentileEmit {
    pub query_id: String,
    pub operator_id: String,
    pub service: String,
    pub percentile: String,
    pub estimated_value: f64,
    pub window_start_ns: i64,
    pub window_end_ns: i64,
    pub revision: u64,
    pub finalized: bool,
    pub observation_count: u64,
    pub sketch_state_bytes: usize,
    pub watermark_ns: i64,
    pub late_contribution: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SketchBlob {
    alpha: f64,
    values: Vec<f64>,
}

/// Deterministic bounded sketch wrapper. Snapshot/restore replays adds into a fresh DDSketch
/// so restore does not depend on unstable internal addresses.
#[derive(Clone)]
pub struct BoundedPercentileSketch {
    alpha: f64,
    sketch: DDSketch,
    /// Compact deterministic sample buffer used only for snapshot/restore and state sizing.
    /// Cap prevents unbounded growth; once capped, further values update the sketch only.
    replay_buf: Vec<f64>,
    replay_cap: usize,
    observation_count: u64,
}

impl BoundedPercentileSketch {
    pub fn new(alpha: f64) -> Self {
        let alpha = if alpha <= 0.0 || alpha >= 1.0 {
            DEFAULT_SKETCH_ALPHA
        } else {
            alpha
        };
        Self {
            alpha,
            sketch: DDSketch::new(Config::new(alpha, 2048, 1.0e-9)),
            replay_buf: Vec::new(),
            replay_cap: 4_096,
            observation_count: 0,
        }
    }

    pub fn add(&mut self, v: f64) {
        if !v.is_finite() {
            return;
        }
        self.sketch.add(v);
        self.observation_count = self.observation_count.saturating_add(1);
        if self.replay_buf.len() < self.replay_cap {
            self.replay_buf.push(v);
        }
    }

    pub fn quantile(&self, q: f64) -> Option<f64> {
        self.sketch.quantile(q).ok().flatten()
    }

    pub fn count(&self) -> u64 {
        self.observation_count
    }

    pub fn state_bytes(&self) -> usize {
        // Bound reported size by bin budget + replay buffer, never raw observation count.
        64 + self.replay_buf.len() * 8 + 256
    }

    pub fn merge_from(&mut self, other: &Self) {
        let _ = self.sketch.merge(&other.sketch);
        self.observation_count = self.observation_count.saturating_add(other.observation_count);
        for v in &other.replay_buf {
            if self.replay_buf.len() >= self.replay_cap {
                break;
            }
            self.replay_buf.push(*v);
        }
    }

    pub fn to_blob(&self) -> Vec<u8> {
        serde_json::to_vec(&SketchBlob {
            alpha: self.alpha,
            values: self.replay_buf.clone(),
        })
        .unwrap_or_default()
    }

    pub fn from_blob(bytes: &[u8]) -> Result<Self, OperatorError> {
        let blob: SketchBlob = serde_json::from_slice(bytes)
            .map_err(|e| OperatorError::Message(format!("sketch blob: {e}")))?;
        let mut s = Self::new(blob.alpha);
        for v in blob.values {
            s.add(v);
        }
        Ok(s)
    }
}

#[derive(Clone, Default)]
struct WinSketchState {
    sketch: Option<BoundedPercentileSketch>,
    revision: u64,
    finalized: bool,
}

impl WinSketchState {
    fn sketch_mut(&mut self, alpha: f64) -> &mut BoundedPercentileSketch {
        if self.sketch.is_none() {
            self.sketch = Some(BoundedPercentileSketch::new(alpha));
        }
        self.sketch.as_mut().unwrap()
    }
}

pub struct PercentileOperator {
    id: String,
    query_id: String,
    kind: WindowKind,
    late_grace_ns: i64,
    alpha: f64,
    percentiles: Vec<PercentileKind>,
    /// Only ingest metric names containing this substring (default "lat").
    name_contains: String,
    state: BTreeMap<String, BTreeMap<(i64, i64), WinSketchState>>,
    metrics: OperatorMetrics,
    last_emits: Vec<PercentileEmit>,
    active_windows: usize,
    finalized_windows: usize,
    validation_mode: bool,
    last_validation_error: Option<f64>,
}

impl PercentileOperator {
    pub fn new(
        id: impl Into<String>,
        query_id: impl Into<String>,
        kind: WindowKind,
        late_grace_ns: i64,
    ) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            query_id: query_id.into(),
            kind,
            late_grace_ns,
            alpha: DEFAULT_SKETCH_ALPHA,
            percentiles: PercentileKind::all().to_vec(),
            name_contains: "lat".into(),
            state: BTreeMap::new(),
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
            last_emits: Vec::new(),
            active_windows: 0,
            finalized_windows: 0,
            validation_mode: false,
            last_validation_error: None,
        }
    }

    pub fn with_alpha(mut self, alpha: f64) -> Self {
        self.alpha = alpha;
        self
    }

    pub fn with_validation_mode(mut self, on: bool) -> Self {
        self.validation_mode = on;
        self
    }

    pub fn last_emits(&self) -> &[PercentileEmit] {
        &self.last_emits
    }

    pub fn active_window_count(&self) -> usize {
        self.active_windows
    }

    pub fn finalized_window_count(&self) -> usize {
        self.finalized_windows
    }

    pub fn last_validation_error(&self) -> Option<f64> {
        self.last_validation_error
    }

    pub fn alpha(&self) -> f64 {
        self.alpha
    }

    fn covers(&self, event_time_ns: i64) -> Vec<(i64, i64)> {
        match self.kind {
            WindowKind::Tumbling { size_ns } => {
                let size = size_ns.max(1);
                let start = (event_time_ns.div_euclid(size)) * size;
                vec![(start, start + size)]
            }
            WindowKind::Hopping { size_ns, slide_ns } => {
                let size = size_ns.max(1);
                let slide = slide_ns.max(1);
                let mut out = Vec::new();
                let first = event_time_ns - size + slide;
                let mut s = if first < 0 {
                    0
                } else {
                    (first.div_euclid(slide)) * slide
                };
                while s <= event_time_ns {
                    if event_time_ns >= s && event_time_ns < s + size {
                        out.push((s, s + size));
                    }
                    s += slide;
                }
                out.sort_unstable();
                out.dedup();
                out
            }
        }
    }

    fn emit_for(
        &self,
        service: &str,
        start: i64,
        end: i64,
        st: &WinSketchState,
        watermark_ns: i64,
        late: bool,
    ) -> Vec<PercentileEmit> {
        let Some(sketch) = &st.sketch else {
            return Vec::new();
        };
        if sketch.count() == 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        for p in &self.percentiles {
            let Some(est) = sketch.quantile(p.quantile()) else {
                continue;
            };
            out.push(PercentileEmit {
                query_id: self.query_id.clone(),
                operator_id: self.id.clone(),
                service: service.to_owned(),
                percentile: p.label().to_owned(),
                estimated_value: est,
                window_start_ns: start,
                window_end_ns: end,
                revision: st.revision,
                finalized: st.finalized,
                observation_count: sketch.count(),
                sketch_state_bytes: sketch.state_bytes(),
                watermark_ns,
                late_contribution: late,
            });
        }
        out
    }

    fn ingest_row(
        &mut self,
        service: &str,
        event_time_ns: i64,
        value: f64,
        watermark_ns: i64,
    ) -> Result<Vec<PercentileEmit>, OperatorError> {
        if !value.is_finite() {
            return Ok(Vec::new());
        }
        let mut emits = Vec::new();
        for (start, end) in self.covers(event_time_ns) {
            let g = self.state.entry(service.to_owned()).or_default();
            let st = g.entry((start, end)).or_default();
            if st.finalized {
                if watermark_ns != i64::MIN && end + self.late_grace_ns < watermark_ns {
                    self.metrics.late_events += 1;
                    continue;
                }
            }
            let late = watermark_ns != i64::MIN && event_time_ns <= watermark_ns;
            st.sketch_mut(self.alpha).add(value);
            st.revision = st.revision.saturating_add(1);
            let st_clone = st.clone();
            emits.extend(self.emit_for(service, start, end, &st_clone, watermark_ns, late));
        }
        self.active_windows = self.state.values().map(|m| m.len()).sum();
        Ok(emits)
    }

    fn finalize_due(&mut self, watermark_ns: i64) -> Vec<PercentileEmit> {
        let mut emits = Vec::new();
        let services: Vec<_> = self.state.keys().cloned().collect();
        for service in services {
            let keys: Vec<_> = self
                .state
                .get(&service)
                .map(|w| w.keys().cloned().collect())
                .unwrap_or_default();
            for (start, end) in keys {
                let Some(st) = self
                    .state
                    .get_mut(&service)
                    .and_then(|w| w.get_mut(&(start, end)))
                else {
                    continue;
                };
                if st.finalized {
                    continue;
                }
                if watermark_ns >= end {
                    st.finalized = true;
                    st.revision = st.revision.saturating_add(1);
                    self.finalized_windows += 1;
                    let st_clone = st.clone();
                    emits.extend(self.emit_for(
                        &service,
                        start,
                        end,
                        &st_clone,
                        watermark_ns,
                        false,
                    ));
                }
            }
        }
        for windows in self.state.values_mut() {
            windows.retain(|(_start, end), st| {
                !(st.finalized && watermark_ns >= *end + self.late_grace_ns)
            });
        }
        self.active_windows = self.state.values().map(|m| m.len()).sum();
        emits
    }

    /// Emit Arrow batch of percentile rows (stable sort by service, window, percentile).
    pub fn emits_to_batch(emits: &[PercentileEmit]) -> Result<RecordBatch, OperatorError> {
        let mut sorted: Vec<_> = emits.iter().collect();
        sorted.sort_by(|a, b| {
            a.service
                .cmp(&b.service)
                .then(a.window_start_ns.cmp(&b.window_start_ns))
                .then(a.percentile.cmp(&b.percentile))
                .then(a.revision.cmp(&b.revision))
        });
        let mut service = StringBuilder::new();
        let mut percentile = StringBuilder::new();
        let mut value = Float64Builder::new();
        let mut start = Int64Builder::new();
        let mut end = Int64Builder::new();
        let mut rev = UInt64Builder::new();
        let mut count = UInt64Builder::new();
        let mut finalized = Int64Builder::new();
        for e in sorted {
            service.append_value(&e.service);
            percentile.append_value(&e.percentile);
            value.append_value(e.estimated_value);
            start.append_value(e.window_start_ns);
            end.append_value(e.window_end_ns);
            rev.append_value(e.revision);
            count.append_value(e.observation_count);
            finalized.append_value(if e.finalized { 1 } else { 0 });
        }
        RecordBatch::try_new(
            Arc::new(Schema::new(vec![
                Field::new("service", DataType::Utf8, false),
                Field::new("percentile", DataType::Utf8, false),
                Field::new("value", DataType::Float64, false),
                Field::new("window_start_ns", DataType::Int64, false),
                Field::new("window_end_ns", DataType::Int64, false),
                Field::new("revision", DataType::UInt64, false),
                Field::new("observation_count", DataType::UInt64, false),
                Field::new("finalized", DataType::Int64, false),
            ])),
            vec![
                Arc::new(service.finish()),
                Arc::new(percentile.finish()),
                Arc::new(value.finish()),
                Arc::new(start.finish()),
                Arc::new(end.finish()),
                Arc::new(rev.finish()),
                Arc::new(count.finish()),
                Arc::new(finalized.finish()),
            ],
        )
        .map_err(|e| OperatorError::Message(e.to_string()))
    }
}

impl Operator for PercentileOperator {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.batches_in += 1;
        self.metrics.rows_in += batch.batch.num_rows() as u64;
        self.last_emits.clear();

        let services = batch
            .batch
            .column_by_name("service")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let times = batch
            .batch
            .column_by_name("event_time_ns")
            .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
        let values = batch
            .batch
            .column_by_name("value")
            .and_then(|c| c.as_any().downcast_ref::<Float64Array>());
        let names = batch
            .batch
            .column_by_name("name")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let (Some(services), Some(times), Some(values)) = (services, times, values) else {
            return Err(OperatorError::Message(
                "percentile expects service,event_time_ns,value".into(),
            ));
        };
        let wm = batch
            .watermark_ns
            .unwrap_or(self.metrics.current_watermark_ns);
        for i in 0..batch.batch.num_rows() {
            if services.is_null(i) || values.is_null(i) {
                continue;
            }
            if let Some(names) = names {
                if names.is_null(i) || !names.value(i).contains(&self.name_contains) {
                    continue;
                }
            }
            let v = values.value(i);
            let emits = self.ingest_row(services.value(i), times.value(i), v, wm)?;
            self.last_emits.extend(emits);
        }
        self.last_emits.sort_by(|a, b| {
            a.service
                .cmp(&b.service)
                .then(a.window_start_ns.cmp(&b.window_start_ns))
                .then(a.percentile.cmp(&b.percentile))
        });
        self.metrics.batches_out += 1;
        self.metrics.rows_out += self.last_emits.len() as u64;
        Ok(vec![batch])
    }

    fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.current_watermark_ns = watermark_ns;
        let emits = self.finalize_due(watermark_ns);
        self.last_emits.extend(emits);
        Ok(Vec::new())
    }

    fn on_control(&mut self, ctrl: &ControlMessage) -> Result<Vec<RuntimeBatch>, OperatorError> {
        if matches!(
            ctrl,
            ControlMessage::Reset | ControlMessage::Seek { .. } | ControlMessage::EndOfSource
        ) {
            if matches!(ctrl, ControlMessage::EndOfSource) {
                let wm = self.metrics.current_watermark_ns;
                let emits = self.finalize_due(if wm == i64::MIN { i64::MAX / 4 } else { wm });
                self.last_emits.extend(emits);
            } else {
                self.state.clear();
                self.active_windows = 0;
                self.finalized_windows = 0;
                self.last_emits.clear();
                self.last_validation_error = None;
                self.metrics = OperatorMetrics {
                    operator_id: self.id.clone(),
                    ..Default::default()
                };
            }
        }
        Ok(Vec::new())
    }

    fn snapshot(&self) -> OperatorSnapshot {
        let mut blob = Vec::new();
        for (svc, windows) in &self.state {
            for ((start, end), st) in windows {
                if let Some(sk) = &st.sketch {
                    let piece = format!(
                        "{svc}|{start}|{end}|{}|{}\n",
                        st.revision,
                        hex::encode(sk.to_blob())
                    );
                    blob.extend(piece.as_bytes());
                }
            }
        }
        OperatorSnapshot {
            operator_id: self.id.clone(),
            watermark_ns: self.metrics.current_watermark_ns,
            state_bytes: blob.len(),
            blob,
        }
    }

    fn restore(&mut self, snapshot: OperatorSnapshot) -> Result<(), OperatorError> {
        self.state.clear();
        let text = String::from_utf8_lossy(&snapshot.blob);
        for line in text.lines() {
            let parts: Vec<_> = line.split('|').collect();
            if parts.len() != 5 {
                continue;
            }
            let svc = parts[0];
            let start: i64 = parts[1]
                .parse()
                .map_err(|e| OperatorError::Message(format!("start: {e}")))?;
            let end: i64 = parts[2]
                .parse()
                .map_err(|e| OperatorError::Message(format!("end: {e}")))?;
            let revision: u64 = parts[3]
                .parse()
                .map_err(|e| OperatorError::Message(format!("rev: {e}")))?;
            let bytes = hex::decode(parts[4])
                .map_err(|e| OperatorError::Message(format!("hex: {e}")))?;
            let sketch = BoundedPercentileSketch::from_blob(&bytes)?;
            let mut st = WinSketchState {
                sketch: Some(sketch),
                revision,
                finalized: false,
            };
            let _ = &mut st;
            self.state
                .entry(svc.to_owned())
                .or_default()
                .insert((start, end), st);
        }
        self.active_windows = self.state.values().map(|m| m.len()).sum();
        self.metrics.current_watermark_ns = snapshot.watermark_ns;
        Ok(())
    }

    fn metrics(&self) -> OperatorMetrics {
        let mut m = self.metrics.clone();
        m.state_bytes = self
            .state
            .values()
            .flat_map(|w| w.values())
            .map(|st| st.sketch.as_ref().map(|s| s.state_bytes()).unwrap_or(0))
            .sum();
        m
    }
}

/// Exact percentile on a sorted ascending slice (linear rank).
pub fn exact_percentile_sorted(sorted: &[f64], q: f64) -> Option<f64> {
    if sorted.is_empty() || !(0.0..=1.0).contains(&q) {
        return None;
    }
    if sorted.len() == 1 {
        return Some(sorted[0]);
    }
    let rank = q * (sorted.len() as f64 - 1.0);
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    if lo == hi {
        Some(sorted[lo])
    } else {
        let w = rank - lo as f64;
        Some(sorted[lo] * (1.0 - w) + sorted[hi] * w)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn sketch_rejects_non_finite() {
        let mut s = BoundedPercentileSketch::new(0.01);
        s.add(f64::NAN);
        s.add(f64::INFINITY);
        assert_eq!(s.count(), 0);
    }

    #[test]
    fn empty_window_no_emit() {
        let mut op = PercentileOperator::new("p", "q", WindowKind::Tumbling { size_ns: 100 }, 0);
        let _ = op.on_watermark(1_000);
        assert!(op.last_emits().is_empty());
    }

    #[test]
    fn accuracy_uniform_within_bound() {
        let mut s = BoundedPercentileSketch::new(0.01);
        let mut exact = Vec::new();
        for i in 1..=1_000 {
            let v = i as f64;
            s.add(v);
            exact.push(v);
        }
        exact.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for (kind, q) in [
            (PercentileKind::P50, 0.5),
            (PercentileKind::P95, 0.95),
            (PercentileKind::P99, 0.99),
        ] {
            let est = s.quantile(q).unwrap();
            let truth = exact_percentile_sorted(&exact, q).unwrap();
            let rel = ((est - truth) / truth).abs();
            assert!(
                rel <= ACCEPTABLE_RELATIVE_ERROR * 2.0,
                "{} rel err {rel} est {est} truth {truth}",
                kind.label()
            );
        }
    }

    #[test]
    fn snapshot_round_trip() {
        let mut op = PercentileOperator::new("p", "q", WindowKind::Tumbling { size_ns: 1_000 }, 0);
        // Build a tiny batch via ingest_row
        let _ = op.ingest_row("svc", 100, 10.0, 0).unwrap();
        let _ = op.ingest_row("svc", 200, 50.0, 0).unwrap();
        let snap = op.snapshot();
        let mut op2 = PercentileOperator::new("p", "q", WindowKind::Tumbling { size_ns: 1_000 }, 0);
        op2.restore(snap).unwrap();
        assert_eq!(op2.active_window_count(), op.active_window_count());
    }

    proptest! {
        #[test]
        fn sketch_count_matches_finite_adds(vals in prop::collection::vec(-1000.0f64..1000.0, 0..200)) {
            let mut s = BoundedPercentileSketch::new(0.01);
            let mut n = 0u64;
            for v in vals {
                if v.is_finite() {
                    s.add(v);
                    n += 1;
                }
            }
            assert_eq!(s.count(), n);
        }
    }
}
