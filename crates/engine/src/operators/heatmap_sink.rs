use faultline_projection::{HeatmapCell, HeatmapProjection};
use indexmap::IndexMap;

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics};
use crate::operators::window::WindowEmit;

/// Collects window emits into a heatmap projection (service × window start).
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
            });
            if entry.finalized && e.late_contribution && e.revision <= entry.revision {
                continue;
            }
            if entry.finalized && !e.late_contribution && e.finalized {
                // finalized replace only with higher revision
                if e.revision < entry.revision {
                    continue;
                }
            }
            entry.value = e.value;
            entry.sample_count = e.count;
            entry.revision = e.revision;
            entry.finalized = e.finalized;
            self.revisions = self.revisions.max(e.projection_version);
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
