//! Bounded event-time interval join for deployment correlation (TA-027).
//!
//! Semantics: **left temporal interval join**.
//! Left (telemetry) rows are always retained. Right (deployment/config) rows match when
//! `right.event_time ∈ [left.event_time - lookback, left.event_time + lookahead]` and
//! canonical service keys are equal. Multiple right matches are allowed; results are
//! deterministically ordered. This is not root-cause inference.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::message::{ControlMessage, RuntimeBatch};
use crate::operator::{Operator, OperatorError, OperatorMetrics, OperatorSnapshot};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JoinEmit {
    pub query_id: String,
    pub operator_id: String,
    pub telemetry_ref: String,
    pub service: String,
    pub change_id: String,
    pub change_type: String,
    pub deployed_version: Option<String>,
    pub telemetry_time_ns: i64,
    pub change_time_ns: i64,
    pub window_start_ns: i64,
    pub window_end_ns: i64,
    pub time_delta_ns: i64,
    pub match_reason: String,
    pub revision: u64,
    pub finalized: bool,
    pub unmatched: bool,
}

#[derive(Clone, Debug)]
struct LeftRow {
    telemetry_ref: String,
    service: String,
    event_time_ns: i64,
    window_start_ns: i64,
    window_end_ns: i64,
    seen_change_ids: BTreeSet<String>,
}

#[derive(Clone, Debug)]
struct RightRow {
    change_id: String,
    change_type: String,
    deployed_version: Option<String>,
    service: String,
    event_time_ns: i64,
    event_id: String,
}

pub struct TemporalIntervalJoin {
    id: String,
    query_id: String,
    lookback_ns: i64,
    lookahead_ns: i64,
    late_grace_ns: i64,
    left: BTreeMap<String, Vec<LeftRow>>,
    right: BTreeMap<String, Vec<RightRow>>,
    seen_pair_keys: BTreeSet<String>,
    metrics: OperatorMetrics,
    last_emits: Vec<JoinEmit>,
    matches: u64,
    unmatched: u64,
    expired: u64,
    revision: u64,
}

impl TemporalIntervalJoin {
    pub fn new(
        id: impl Into<String>,
        query_id: impl Into<String>,
        lookback_ns: i64,
        lookahead_ns: i64,
        late_grace_ns: i64,
    ) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            query_id: query_id.into(),
            lookback_ns,
            lookahead_ns,
            late_grace_ns,
            left: BTreeMap::new(),
            right: BTreeMap::new(),
            seen_pair_keys: BTreeSet::new(),
            metrics: OperatorMetrics {
                operator_id: id,
                ..Default::default()
            },
            last_emits: Vec::new(),
            matches: 0,
            unmatched: 0,
            expired: 0,
            revision: 0,
        }
    }

    pub fn last_emits(&self) -> &[JoinEmit] {
        &self.last_emits
    }

    pub fn left_state_rows(&self) -> usize {
        self.left.values().map(|v| v.len()).sum()
    }

    pub fn right_state_rows(&self) -> usize {
        self.right.values().map(|v| v.len()).sum()
    }

    pub fn match_count(&self) -> u64 {
        self.matches
    }

    pub fn unmatched_count(&self) -> u64 {
        self.unmatched
    }

    pub fn expired_count(&self) -> u64 {
        self.expired
    }

    pub fn lookback_ns(&self) -> i64 {
        self.lookback_ns
    }

    pub fn lookahead_ns(&self) -> i64 {
        self.lookahead_ns
    }

    pub fn push_telemetry(
        &mut self,
        telemetry_ref: impl Into<String>,
        service: impl Into<String>,
        event_time_ns: i64,
        window_start_ns: i64,
        window_end_ns: i64,
        watermark_ns: i64,
    ) -> Vec<JoinEmit> {
        let service = service.into();
        let telemetry_ref = telemetry_ref.into();
        let mut row = LeftRow {
            telemetry_ref: telemetry_ref.clone(),
            service: service.clone(),
            event_time_ns,
            window_start_ns,
            window_end_ns,
            seen_change_ids: BTreeSet::new(),
        };
        let mut emits = self.match_left_against_right(&mut row, watermark_ns);
        if emits.is_empty() {
            self.revision = self.revision.saturating_add(1);
            emits.push(JoinEmit {
                query_id: self.query_id.clone(),
                operator_id: self.id.clone(),
                telemetry_ref,
                service: service.clone(),
                change_id: String::new(),
                change_type: String::new(),
                deployed_version: None,
                telemetry_time_ns: event_time_ns,
                change_time_ns: 0,
                window_start_ns,
                window_end_ns,
                time_delta_ns: 0,
                match_reason: "unmatched_telemetry".into(),
                revision: self.revision,
                finalized: false,
                unmatched: true,
            });
            self.unmatched = self.unmatched.saturating_add(1);
        }
        self.left.entry(service).or_default().push(row);
        self.last_emits.extend(emits.clone());
        emits
    }

    #[allow(clippy::too_many_arguments)]
    pub fn push_deployment(
        &mut self,
        event_id: impl Into<String>,
        change_id: impl Into<String>,
        change_type: impl Into<String>,
        service: impl Into<String>,
        event_time_ns: i64,
        deployed_version: Option<String>,
        watermark_ns: i64,
    ) -> Vec<JoinEmit> {
        let service = service.into();
        let change_id = change_id.into();
        let event_id = event_id.into();
        // Duplicate protection by change_id + event_id.
        if let Some(rows) = self.right.get(&service) {
            if rows
                .iter()
                .any(|r| r.change_id == change_id && r.event_id == event_id)
            {
                return Vec::new();
            }
        }
        let right = RightRow {
            change_id: change_id.clone(),
            change_type: change_type.into(),
            deployed_version,
            service: service.clone(),
            event_time_ns,
            event_id,
        };
        let emits = self.match_right_against_left(&right, watermark_ns);
        self.right.entry(service).or_default().push(right);
        self.last_emits.extend(emits.clone());
        emits
    }

    fn in_interval(lookback_ns: i64, lookahead_ns: i64, left_t: i64, right_t: i64) -> bool {
        let lo = left_t.saturating_sub(lookback_ns);
        let hi = left_t.saturating_add(lookahead_ns);
        right_t >= lo && right_t <= hi
    }

    fn pair_key(left_ref: &str, change_id: &str) -> String {
        format!("{left_ref}|{change_id}")
    }

    fn match_left_against_right(&mut self, left: &mut LeftRow, watermark_ns: i64) -> Vec<JoinEmit> {
        let mut emits = Vec::new();
        let Some(rights) = self.right.get(&left.service).cloned() else {
            return emits;
        };
        for r in rights {
            if !Self::in_interval(
                self.lookback_ns,
                self.lookahead_ns,
                left.event_time_ns,
                r.event_time_ns,
            ) {
                continue;
            }
            let key = Self::pair_key(&left.telemetry_ref, &r.change_id);
            if !self.seen_pair_keys.insert(key) {
                continue;
            }
            left.seen_change_ids.insert(r.change_id.clone());
            self.revision = self.revision.saturating_add(1);
            self.matches = self.matches.saturating_add(1);
            let late = watermark_ns != i64::MIN && left.event_time_ns <= watermark_ns;
            emits.push(JoinEmit {
                query_id: self.query_id.clone(),
                operator_id: self.id.clone(),
                telemetry_ref: left.telemetry_ref.clone(),
                service: left.service.clone(),
                change_id: r.change_id.clone(),
                change_type: r.change_type.clone(),
                deployed_version: r.deployed_version.clone(),
                telemetry_time_ns: left.event_time_ns,
                change_time_ns: r.event_time_ns,
                window_start_ns: left.window_start_ns,
                window_end_ns: left.window_end_ns,
                time_delta_ns: left.event_time_ns - r.event_time_ns,
                match_reason: if late {
                    "interval_match_late_revision".into()
                } else {
                    "interval_match".into()
                },
                revision: self.revision,
                finalized: false,
                unmatched: false,
            });
        }
        emits
    }

    fn match_right_against_left(&mut self, right: &RightRow, watermark_ns: i64) -> Vec<JoinEmit> {
        let mut emits = Vec::new();
        let lookback = self.lookback_ns;
        let lookahead = self.lookahead_ns;
        let Some(lefts) = self.left.get_mut(&right.service) else {
            return emits;
        };
        let mut pending: Vec<(String, i64, i64, i64)> = Vec::new();
        for left in lefts.iter_mut() {
            if !Self::in_interval(lookback, lookahead, left.event_time_ns, right.event_time_ns) {
                continue;
            }
            let key = Self::pair_key(&left.telemetry_ref, &right.change_id);
            if self.seen_pair_keys.contains(&key) {
                continue;
            }
            left.seen_change_ids.insert(right.change_id.clone());
            pending.push((
                left.telemetry_ref.clone(),
                left.event_time_ns,
                left.window_start_ns,
                left.window_end_ns,
            ));
            self.seen_pair_keys.insert(key);
        }
        for (telemetry_ref, telemetry_time_ns, window_start_ns, window_end_ns) in pending {
            self.revision = self.revision.saturating_add(1);
            self.matches = self.matches.saturating_add(1);
            let late = watermark_ns != i64::MIN && right.event_time_ns <= watermark_ns;
            emits.push(JoinEmit {
                query_id: self.query_id.clone(),
                operator_id: self.id.clone(),
                telemetry_ref,
                service: right.service.clone(),
                change_id: right.change_id.clone(),
                change_type: right.change_type.clone(),
                deployed_version: right.deployed_version.clone(),
                telemetry_time_ns,
                change_time_ns: right.event_time_ns,
                window_start_ns,
                window_end_ns,
                time_delta_ns: telemetry_time_ns - right.event_time_ns,
                match_reason: if late {
                    "interval_match_late_revision".into()
                } else {
                    "interval_match".into()
                },
                revision: self.revision,
                finalized: false,
                unmatched: false,
            });
        }
        emits
    }

    pub fn on_watermark_cleanup(&mut self, watermark_ns: i64) -> Vec<JoinEmit> {
        let retain_left_before = watermark_ns.saturating_sub(self.lookback_ns + self.late_grace_ns);
        let retain_right_before =
            watermark_ns.saturating_sub(self.lookahead_ns + self.late_grace_ns);
        let mut finalized = Vec::new();
        for rows in self.left.values_mut() {
            for row in rows.iter_mut() {
                if row.event_time_ns < retain_left_before {
                    self.revision = self.revision.saturating_add(1);
                    finalized.push(JoinEmit {
                        query_id: self.query_id.clone(),
                        operator_id: self.id.clone(),
                        telemetry_ref: row.telemetry_ref.clone(),
                        service: row.service.clone(),
                        change_id: row
                            .seen_change_ids
                            .iter()
                            .next()
                            .cloned()
                            .unwrap_or_default(),
                        change_type: String::new(),
                        deployed_version: None,
                        telemetry_time_ns: row.event_time_ns,
                        change_time_ns: 0,
                        window_start_ns: row.window_start_ns,
                        window_end_ns: row.window_end_ns,
                        time_delta_ns: 0,
                        match_reason: "finalized_left".into(),
                        revision: self.revision,
                        finalized: true,
                        unmatched: row.seen_change_ids.is_empty(),
                    });
                }
            }
            let before = rows.len();
            rows.retain(|r| r.event_time_ns >= retain_left_before);
            self.expired += (before - rows.len()) as u64;
        }
        for rows in self.right.values_mut() {
            let before = rows.len();
            rows.retain(|r| r.event_time_ns >= retain_right_before);
            self.expired += (before - rows.len()) as u64;
        }
        self.left.retain(|_, v| !v.is_empty());
        self.right.retain(|_, v| !v.is_empty());
        self.last_emits.extend(finalized.clone());
        finalized
    }

    pub fn reset(&mut self) {
        self.left.clear();
        self.right.clear();
        self.seen_pair_keys.clear();
        self.last_emits.clear();
        self.matches = 0;
        self.unmatched = 0;
        self.expired = 0;
        self.revision = 0;
        self.metrics = OperatorMetrics {
            operator_id: self.id.clone(),
            ..Default::default()
        };
    }
}

impl Operator for TemporalIntervalJoin {
    fn id(&self) -> &str {
        &self.id
    }

    fn on_batch(&mut self, batch: RuntimeBatch) -> Result<Vec<RuntimeBatch>, OperatorError> {
        use arrow::array::{Array, Int64Array, StringArray};
        self.metrics.batches_in += 1;
        self.metrics.rows_in += batch.batch.num_rows() as u64;
        let wm = batch
            .watermark_ns
            .unwrap_or(self.metrics.current_watermark_ns);

        // Changes path: event_id, service, change_id, change_type, event_time_ns, optional version_after
        if batch.batch.column_by_name("change_id").is_some() {
            let event_ids = batch
                .batch
                .column_by_name("event_id")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| OperatorError::Message("join changes event_id".into()))?;
            let services = batch
                .batch
                .column_by_name("service")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| OperatorError::Message("join changes service".into()))?;
            let change_ids = batch
                .batch
                .column_by_name("change_id")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| OperatorError::Message("join change_id".into()))?;
            let change_types = batch
                .batch
                .column_by_name("change_type")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| OperatorError::Message("join change_type".into()))?;
            let times = batch
                .batch
                .column_by_name("event_time_ns")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>())
                .ok_or_else(|| OperatorError::Message("join event_time".into()))?;
            let versions = batch
                .batch
                .column_by_name("version_after")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            for i in 0..batch.batch.num_rows() {
                if services.is_null(i) {
                    continue;
                }
                let ver = versions.and_then(|v| {
                    if v.is_null(i) {
                        None
                    } else {
                        Some(v.value(i).to_owned())
                    }
                });
                let _ = self.push_deployment(
                    event_ids.value(i),
                    change_ids.value(i),
                    change_types.value(i),
                    services.value(i),
                    times.value(i),
                    ver,
                    wm,
                );
            }
        } else if batch.batch.column_by_name("window_start_ns").is_some() {
            // Telemetry aggregate path from percentile emits converted to batch upstream,
            // or metric rows with window columns.
            let services = batch
                .batch
                .column_by_name("service")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or_else(|| OperatorError::Message("join left service".into()))?;
            let starts = batch
                .batch
                .column_by_name("window_start_ns")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>())
                .ok_or_else(|| OperatorError::Message("join window_start".into()))?;
            let ends = batch
                .batch
                .column_by_name("window_end_ns")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>())
                .ok_or_else(|| OperatorError::Message("join window_end".into()))?;
            let times = batch
                .batch
                .column_by_name("event_time_ns")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
            for i in 0..batch.batch.num_rows() {
                if services.is_null(i) {
                    continue;
                }
                let start = starts.value(i);
                let end = ends.value(i);
                let t = times.map(|c| c.value(i)).unwrap_or(start);
                let tele_ref = format!("{}:{}:{}", services.value(i), start, end);
                let _ = self.push_telemetry(tele_ref, services.value(i), t, start, end, wm);
            }
        }
        self.metrics.batches_out += 1;
        Ok(vec![batch])
    }

    fn on_watermark(&mut self, watermark_ns: i64) -> Result<Vec<RuntimeBatch>, OperatorError> {
        self.metrics.current_watermark_ns = watermark_ns;
        let _ = self.on_watermark_cleanup(watermark_ns);
        Ok(Vec::new())
    }

    fn on_control(&mut self, ctrl: &ControlMessage) -> Result<Vec<RuntimeBatch>, OperatorError> {
        if matches!(ctrl, ControlMessage::Reset | ControlMessage::Seek { .. }) {
            self.reset();
        }
        Ok(Vec::new())
    }

    fn snapshot(&self) -> OperatorSnapshot {
        let blob = serde_json::to_vec(&serde_json::json!({
            "matches": self.matches,
            "unmatched": self.unmatched,
            "left": self.left_state_rows(),
            "right": self.right_state_rows(),
        }))
        .unwrap_or_default();
        OperatorSnapshot {
            operator_id: self.id.clone(),
            watermark_ns: self.metrics.current_watermark_ns,
            state_bytes: self.left_state_rows() * 96 + self.right_state_rows() * 96,
            blob,
        }
    }

    fn restore(&mut self, snapshot: OperatorSnapshot) -> Result<(), OperatorError> {
        self.metrics.current_watermark_ns = snapshot.watermark_ns;
        Ok(())
    }

    fn metrics(&self) -> OperatorMetrics {
        let mut m = self.metrics.clone();
        m.state_bytes = self.left_state_rows() * 96 + self.right_state_rows() * 96;
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_after_deployment_matches() {
        let mut j = TemporalIntervalJoin::new("j", "q", 5_000, 5_000, 1_000);
        let _ = j.push_deployment(
            "e1",
            "c1",
            "deployment",
            "svc",
            10_000,
            Some("v2".into()),
            0,
        );
        let emits = j.push_telemetry("t1", "svc", 12_000, 10_000, 15_000, 0);
        assert!(emits.iter().any(|e| !e.unmatched && e.change_id == "c1"));
    }

    #[test]
    fn telemetry_before_deployment_within_lookahead() {
        let mut j = TemporalIntervalJoin::new("j", "q", 1_000, 5_000, 0);
        let _ = j.push_telemetry("t1", "svc", 10_000, 10_000, 11_000, 0);
        let emits = j.push_deployment(
            "e1",
            "c1",
            "deployment",
            "svc",
            12_000,
            Some("v2".into()),
            0,
        );
        assert!(emits.iter().any(|e| e.change_id == "c1"));
    }

    #[test]
    fn exact_interval_boundaries() {
        let mut j = TemporalIntervalJoin::new("j", "q", 100, 100, 0);
        let _ = j.push_deployment("e1", "c1", "deployment", "svc", 1_000, None, 0);
        let hi = j.push_telemetry("t-hi", "svc", 1_100, 1_000, 1_200, 0);
        let lo = j.push_telemetry("t-lo", "svc", 900, 800, 1_000, 0);
        let out = j.push_telemetry("t-out", "svc", 1_201, 1_200, 1_300, 0);
        assert!(hi.iter().any(|e| !e.unmatched));
        assert!(lo.iter().any(|e| !e.unmatched));
        assert!(out.iter().all(|e| e.unmatched));
    }

    #[test]
    fn no_match_unmatched_telemetry() {
        let mut j = TemporalIntervalJoin::new("j", "q", 10, 10, 0);
        let emits = j.push_telemetry("t1", "svc", 100, 100, 200, 0);
        assert!(emits.iter().all(|e| e.unmatched));
    }

    #[test]
    fn multiple_matches_and_duplicate_protection() {
        let mut j = TemporalIntervalJoin::new("j", "q", 1_000, 1_000, 0);
        let _ = j.push_deployment("e1", "c1", "deployment", "svc", 100, None, 0);
        let _ = j.push_deployment("e2", "c2", "deployment", "svc", 150, None, 0);
        let emits = j.push_telemetry("t1", "svc", 120, 100, 200, 0);
        assert_eq!(emits.iter().filter(|e| !e.unmatched).count(), 2);
        let again = j.push_deployment("e1", "c1", "deployment", "svc", 100, None, 0);
        assert!(again.is_empty());
    }

    #[test]
    fn watermark_cleans_state() {
        let mut j = TemporalIntervalJoin::new("j", "q", 10, 10, 0);
        let _ = j.push_telemetry("t1", "svc", 100, 100, 200, 0);
        let _ = j.push_deployment("e1", "c1", "deployment", "svc", 100, None, 0);
        assert!(j.left_state_rows() > 0);
        let _ = j.on_watermark_cleanup(10_000);
        assert_eq!(j.left_state_rows(), 0);
        assert!(j.expired_count() > 0);
    }

    #[test]
    fn reset_clears() {
        let mut j = TemporalIntervalJoin::new("j", "q", 10, 10, 0);
        let _ = j.push_telemetry("t1", "svc", 100, 100, 200, 0);
        j.reset();
        assert_eq!(j.left_state_rows(), 0);
        assert_eq!(j.match_count(), 0);
    }

    #[test]
    fn deterministic_replay_order() {
        let mut a = TemporalIntervalJoin::new("j", "q", 50, 50, 0);
        let mut b = TemporalIntervalJoin::new("j", "q", 50, 50, 0);
        for j in [&mut a, &mut b] {
            let _ = j.push_deployment("e1", "c1", "deployment", "svc", 100, Some("v2".into()), 0);
            let _ = j.push_telemetry("t1", "svc", 120, 100, 200, 0);
        }
        assert_eq!(a.last_emits().len(), b.last_emits().len());
        assert_eq!(
            a.last_emits()
                .iter()
                .map(|e| (&e.change_id, e.revision))
                .collect::<Vec<_>>(),
            b.last_emits()
                .iter()
                .map(|e| (&e.change_id, e.revision))
                .collect::<Vec<_>>()
        );
    }
}
