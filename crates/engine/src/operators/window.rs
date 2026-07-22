//! Tumbling and hopping event-time windows with revision semantics (TA-025).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics, OperatorSnapshot};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowKind {
    Tumbling { size_ns: i64 },
    Hopping { size_ns: i64, slide_ns: i64 },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WindowEmit {
    pub query_id: String,
    pub operator_id: String,
    pub window_id: String,
    pub group_key: String,
    pub window_start_ns: i64,
    pub window_end_ns: i64,
    pub value: f64,
    pub count: u64,
    pub projection_version: u64,
    pub revision: u64,
    pub finalized: bool,
    pub watermark_ns: i64,
    pub late_contribution: bool,
}

#[derive(Clone, Debug, Default)]
struct WinState {
    sum: f64,
    count: u64,
    revision: u64,
    finalized: bool,
}

pub struct WindowOperator {
    id: String,
    query_id: String,
    kind: WindowKind,
    late_grace_ns: i64,
    /// group_key -> (start,end) -> state
    state: BTreeMap<String, BTreeMap<(i64, i64), WinState>>,
    metrics: OperatorMetrics,
    active_windows: usize,
    finalized_windows: usize,
    projection_version: u64,
    last_emits: Vec<WindowEmit>,
}

impl WindowOperator {
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
            state: BTreeMap::new(),
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
            active_windows: 0,
            finalized_windows: 0,
            projection_version: 0,
            last_emits: Vec::new(),
        }
    }

    pub fn last_emits(&self) -> &[WindowEmit] {
        &self.last_emits
    }

    pub fn active_window_count(&self) -> usize {
        self.active_windows
    }

    pub fn finalized_window_count(&self) -> usize {
        self.finalized_windows
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
                // Last slide start that could cover event_time.
                let mut start = (event_time_ns.div_euclid(slide)) * slide;
                // Walk back while window still covers.
                while start + size > event_time_ns && start >= 0 {
                    if event_time_ns >= start && event_time_ns < start + size {
                        out.push((start, start + size));
                    }
                    if start == 0 {
                        break;
                    }
                    start -= slide;
                }
                // Also check forward one slide boundary alignment from earlier times
                let first = event_time_ns - size + slide;
                let mut s = if first < 0 {
                    0
                } else {
                    (first.div_euclid(slide)) * slide
                };
                while s <= event_time_ns {
                    if event_time_ns >= s && event_time_ns < s + size {
                        let key = (s, s + size);
                        if !out.contains(&key) {
                            out.push(key);
                        }
                    }
                    s += slide;
                }
                out.sort_unstable();
                out.dedup();
                out
            }
        }
    }

    fn window_id(group: &str, start: i64, end: i64) -> String {
        format!("{group}:{start}:{end}")
    }

    fn ingest_row(
        &mut self,
        group: &str,
        event_time_ns: i64,
        value: f64,
        watermark_ns: i64,
    ) -> Result<Vec<WindowEmit>, OperatorError> {
        let mut emits = Vec::new();
        for (start, end) in self.covers(event_time_ns) {
            let g = self.state.entry(group.to_owned()).or_default();
            let st = g.entry((start, end)).or_default();
            if st.finalized {
                // Beyond finalization: only revise within grace relative to watermark.
                if watermark_ns != i64::MIN && event_time_ns + self.late_grace_ns < watermark_ns {
                    self.metrics.late_events += 1;
                    continue;
                }
                // Treat as late revisable if still within grace after finalize mark.
                if watermark_ns != i64::MIN && end + self.late_grace_ns < watermark_ns {
                    self.metrics.late_events += 1;
                    continue;
                }
            }
            let late = watermark_ns != i64::MIN && event_time_ns <= watermark_ns;
            st.sum += value;
            st.count += 1;
            st.revision = st.revision.saturating_add(1);
            self.projection_version = self.projection_version.saturating_add(1);
            let avg = st.sum / st.count as f64;
            emits.push(WindowEmit {
                query_id: self.query_id.clone(),
                operator_id: self.id.clone(),
                window_id: Self::window_id(group, start, end),
                group_key: group.to_owned(),
                window_start_ns: start,
                window_end_ns: end,
                value: avg,
                count: st.count,
                projection_version: self.projection_version,
                revision: st.revision,
                finalized: st.finalized,
                watermark_ns,
                late_contribution: late,
            });
        }
        self.active_windows = self.state.values().map(|m| m.len()).sum();
        Ok(emits)
    }

    fn finalize_due(&mut self, watermark_ns: i64) -> Vec<WindowEmit> {
        let mut emits = Vec::new();
        for (group, windows) in &mut self.state {
            for ((start, end), st) in windows.iter_mut() {
                if st.finalized {
                    continue;
                }
                // Finalize when watermark passes window end.
                if watermark_ns >= *end {
                    st.finalized = true;
                    st.revision = st.revision.saturating_add(1);
                    self.projection_version = self.projection_version.saturating_add(1);
                    self.finalized_windows += 1;
                    let avg = if st.count == 0 {
                        0.0
                    } else {
                        st.sum / st.count as f64
                    };
                    emits.push(WindowEmit {
                        query_id: self.query_id.clone(),
                        operator_id: self.id.clone(),
                        window_id: Self::window_id(group, *start, *end),
                        group_key: group.clone(),
                        window_start_ns: *start,
                        window_end_ns: *end,
                        value: avg,
                        count: st.count,
                        projection_version: self.projection_version,
                        revision: st.revision,
                        finalized: true,
                        watermark_ns,
                        late_contribution: false,
                    });
                }
            }
        }
        // GC finalized windows older than grace.
        for windows in self.state.values_mut() {
            windows.retain(|(start, end), st| {
                if st.finalized && watermark_ns >= *end + self.late_grace_ns {
                    false
                } else {
                    let _ = start;
                    true
                }
            });
        }
        self.active_windows = self.state.values().map(|m| m.len()).sum();
        emits
    }
}

impl Operator for WindowOperator {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        use arrow::array::{Array, Float64Array, Int64Array, StringArray};
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
        let (Some(services), Some(times), Some(values)) = (services, times, values) else {
            return Err(OperatorError::Message(
                "window expects service,event_time_ns,value".into(),
            ));
        };
        let wm = batch.watermark_ns.unwrap_or(self.metrics.current_watermark_ns);
        for i in 0..batch.batch.num_rows() {
            if services.is_null(i) || values.is_null(i) {
                continue;
            }
            let emits = self.ingest_row(services.value(i), times.value(i), values.value(i), wm)?;
            self.last_emits.extend(emits);
        }
        self.metrics.batches_out += 1;
        // Window emits are carried via last_emits; pass batch through for sinks that need raw rows.
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
                self.metrics = OperatorMetrics {
                    operator_id: self.id.clone(),
                    ..Default::default()
                };
            }
        }
        Ok(Vec::new())
    }

    fn snapshot(&self) -> OperatorSnapshot {
        OperatorSnapshot {
            operator_id: self.id.clone(),
            watermark_ns: self.metrics.current_watermark_ns,
            state_bytes: self.active_windows * 64,
            blob: Vec::new(),
        }
    }

    fn metrics(&self) -> OperatorMetrics {
        let mut m = self.metrics.clone();
        m.state_bytes = self.active_windows * 64;
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tumbling_boundaries() {
        let w = WindowOperator::new("w", "q", WindowKind::Tumbling { size_ns: 100 }, 0);
        assert_eq!(w.covers(0), vec![(0, 100)]);
        assert_eq!(w.covers(99), vec![(0, 100)]);
        assert_eq!(w.covers(100), vec![(100, 200)]);
    }

    #[test]
    fn hopping_multi_cover() {
        let w = WindowOperator::new(
            "w",
            "q",
            WindowKind::Hopping {
                size_ns: 100,
                slide_ns: 50,
            },
            0,
        );
        let covers = w.covers(75);
        assert!(covers.len() >= 2);
    }
}
