use faultline_projection::{HeatmapCell, HeatmapProjection};
use indexmap::IndexMap;

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics};
use crate::operators::percentile::PercentileEmit;
use crate::operators::window::WindowEmit;

/// Collects window / percentile emits into a heatmap projection (service × window start).
pub struct HeatmapSinkExec {
    id: String,
    cells: IndexMap<(String, i64), HeatmapCellState>,
    metrics: OperatorMetrics,
    revisions: u64,
    last_projection: Option<HeatmapProjection>,
    bucket_width_ns: i64,
}

#[derive(Clone, Debug)]
struct HeatmapCellState {
    value: f64,
    sample_count: u64,
    revision: u64,
    finalized: bool,
    p50: Option<f64>,
    p95: Option<f64>,
    p99: Option<f64>,
    metric_kind: Option<String>,
    operator_id: Option<String>,
    window_id: Option<String>,
    value_source: Option<String>,
}

impl HeatmapSinkExec {
    pub fn new(id: impl Into<String>, bucket_width_ns: i64) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            cells: IndexMap::new(),
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
            revisions: 0,
            last_projection: None,
            bucket_width_ns,
        }
    }

    pub fn revisions(&self) -> u64 {
        self.revisions
    }

    pub fn last_projection(&self) -> Option<&HeatmapProjection> {
        self.last_projection.as_ref()
    }

    pub fn apply_emits(&mut self, emits: &[WindowEmit], cursor_ns: i64) {
        for e in emits {
            let key = (e.group_key.clone(), e.window_start_ns);
            let entry = self.cells.entry(key).or_insert(HeatmapCellState {
                value: 0.0,
                sample_count: 0,
                revision: 0,
                finalized: false,
                p50: None,
                p95: None,
                p99: None,
                metric_kind: Some("avg".into()),
                operator_id: Some(e.operator_id.clone()),
                window_id: Some(e.window_id.clone()),
                value_source: Some("window_avg".into()),
            });
            if entry.finalized && e.late_contribution && e.revision <= entry.revision {
                continue;
            }
            if entry.finalized && !e.late_contribution && e.finalized && e.revision < entry.revision
            {
                continue;
            }
            // Do not overwrite percentile-primary latency cells with avg err/mem unless empty.
            if entry.value_source.as_deref() == Some("streaming_p99") {
                continue;
            }
            entry.value = e.value;
            entry.sample_count = e.count;
            entry.revision = e.revision;
            entry.finalized = e.finalized;
            entry.operator_id = Some(e.operator_id.clone());
            entry.window_id = Some(e.window_id.clone());
            self.revisions = self.revisions.max(e.projection_version);
        }
        self.rebuild(cursor_ns);
    }

    pub fn apply_percentile_emits(&mut self, emits: &[PercentileEmit], cursor_ns: i64) {
        for e in emits {
            let key = (e.service.clone(), e.window_start_ns);
            let entry = self.cells.entry(key).or_insert(HeatmapCellState {
                value: 0.0,
                sample_count: 0,
                revision: 0,
                finalized: false,
                p50: None,
                p95: None,
                p99: None,
                metric_kind: Some("lat".into()),
                operator_id: Some(e.operator_id.clone()),
                window_id: Some(format!(
                    "{}:{}:{}",
                    e.service, e.window_start_ns, e.window_end_ns
                )),
                value_source: Some("streaming_p99".into()),
            });
            if entry.finalized && e.late_contribution && e.revision <= entry.revision {
                continue;
            }
            match e.percentile.as_str() {
                "p50" => entry.p50 = Some(e.estimated_value),
                "p95" => entry.p95 = Some(e.estimated_value),
                "p99" => {
                    entry.p99 = Some(e.estimated_value);
                    entry.value = e.estimated_value;
                    entry.value_source = Some("streaming_p99".into());
                }
                _ => {}
            }
            entry.sample_count = e.observation_count;
            entry.revision = e.revision.max(entry.revision);
            entry.finalized = e.finalized;
            entry.metric_kind = Some("lat".into());
            entry.operator_id = Some(e.operator_id.clone());
            self.revisions = self.revisions.max(e.revision);
        }
        self.rebuild(cursor_ns);
    }

    fn rebuild(&mut self, cursor_ns: i64) {
        let mut cells: Vec<HeatmapCell> = self
            .cells
            .iter()
            .map(|((service, bucket), st)| HeatmapCell {
                service: service.clone(),
                bucket_start_ns: *bucket,
                value: st.value,
                sample_count: st.sample_count,
                p50: st.p50,
                p95: st.p95,
                p99: st.p99,
                metric_kind: st.metric_kind.clone(),
                operator_id: st.operator_id.clone(),
                window_id: st.window_id.clone(),
                value_source: st.value_source.clone(),
            })
            .collect();
        cells.sort_by(|a, b| {
            a.service
                .cmp(&b.service)
                .then(a.bucket_start_ns.cmp(&b.bucket_start_ns))
        });
        self.last_projection = Some(HeatmapProjection {
            projection_version: self.revisions.max(1),
            cursor_event_time_ns: cursor_ns,
            bucket_width_ns: self.bucket_width_ns,
            cells,
            streaming_note: Some(
                "latency cells: streaming p99 (DDSketch); err/mem cells: window average".into(),
            ),
        });
    }
}

impl Operator for HeatmapSinkExec {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.batches_in += 1;
        self.metrics.rows_in += batch.batch.num_rows() as u64;
        self.metrics.batches_out += 1;
        Ok(vec![batch])
    }

    fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.current_watermark_ns = watermark_ns;
        Ok(Vec::new())
    }

    fn on_control(&mut self, ctrl: &ControlMessage) -> Result<Vec<RuntimeBatch>, OperatorError> {
        if matches!(ctrl, ControlMessage::Reset | ControlMessage::Seek { .. }) {
            self.cells.clear();
            self.revisions = 0;
            self.last_projection = None;
            self.metrics = OperatorMetrics {
                operator_id: self.id.clone(),
                ..Default::default()
            };
        }
        Ok(Vec::new())
    }

    fn metrics(&self) -> OperatorMetrics {
        self.metrics.clone()
    }
}
