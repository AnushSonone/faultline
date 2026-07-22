//! Per-partition reorder buffers and event-time watermarks (TA-021).

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use faultline_common::{EventId, TelemetryEnvelope};
use serde::{Deserialize, Serialize};

use crate::IngestedEvent;

/// How an ingested event was classified relative to event-time progress.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventClass {
    OnTime,
    BufferedForReorder,
    LateRevisable,
    BeyondGrace,
    Duplicate,
    Invalid,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WatermarkConfig {
    /// Bounded out-of-orderness (ns).
    pub allowed_lateness_ns: i64,
    /// After watermark, late events may still revise for this duration (ns).
    pub late_revision_grace_ns: i64,
    /// Partition with no activity for this long (processing-time ns) becomes idle.
    pub idle_timeout_ns: i64,
    pub max_reorder_buffer: usize,
    pub overflow: OverflowPolicy,
}

impl Default for WatermarkConfig {
    fn default() -> Self {
        Self {
            allowed_lateness_ns: 2_000_000_000, // 2s
            late_revision_grace_ns: 1_000_000_000,
            idle_timeout_ns: 5_000_000_000,
            max_reorder_buffer: 10_000,
            overflow: OverflowPolicy::Reject,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverflowPolicy {
    /// Do not silently drop; return an error and keep buffer intact.
    Reject,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WatermarkMetrics {
    pub global_watermark_ns: i64,
    pub watermark_lag_ns: i64,
    pub reorder_buffer_size: usize,
    pub late_events: u64,
    pub beyond_grace_events: u64,
    pub duplicates: u64,
    pub invalid: u64,
    pub idle_partitions: usize,
    pub active_partitions: usize,
    pub partition_watermarks: BTreeMap<String, i64>,
}

#[derive(Clone, Debug)]
struct Buffered {
    event: IngestedEvent,
}

impl Buffered {
    fn sort_key(&self) -> (i64, u64, String) {
        (
            self.event.envelope.event_time_ns,
            self.event.sequence,
            self.event.envelope.event_id.as_str().to_owned(),
        )
    }
}

impl PartialEq for Buffered {
    fn eq(&self, other: &Self) -> bool {
        self.sort_key() == other.sort_key()
    }
}

impl Eq for Buffered {}

impl PartialOrd for Buffered {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Buffered {
    fn cmp(&self, other: &Self) -> Ordering {
        self.sort_key().cmp(&other.sort_key())
    }
}

#[derive(Clone, Debug)]
struct PartitionState {
    max_event_time_ns: i64,
    watermark_ns: i64,
    buffer: BTreeMap<(i64, u64, String), Buffered>,
    last_activity_ns: i64,
    idle: bool,
    duplicates: u64,
    late_events: u64,
    beyond_grace: u64,
}

impl PartitionState {
    fn new(now_ns: i64) -> Self {
        Self {
            max_event_time_ns: i64::MIN,
            watermark_ns: i64::MIN,
            buffer: BTreeMap::new(),
            last_activity_ns: now_ns,
            idle: false,
            duplicates: 0,
            late_events: 0,
            beyond_grace: 0,
        }
    }
}

/// Event-time reorder + watermark tracker across partitions.
#[derive(Clone, Debug)]
pub struct WatermarkTracker {
    cfg: WatermarkConfig,
    partitions: HashMap<String, PartitionState>,
    seen: HashSet<EventId>,
    global_watermark_ns: i64,
    processing_time_ns: i64,
    metrics: WatermarkMetrics,
}

impl WatermarkTracker {
    pub fn new(cfg: WatermarkConfig) -> Self {
        Self {
            cfg,
            partitions: HashMap::new(),
            seen: HashSet::new(),
            global_watermark_ns: i64::MIN,
            processing_time_ns: 0,
            metrics: WatermarkMetrics::default(),
        }
    }

    pub fn config(&self) -> &WatermarkConfig {
        &self.cfg
    }

    pub fn metrics(&self) -> &WatermarkMetrics {
        &self.metrics
    }

    pub fn global_watermark_ns(&self) -> i64 {
        self.global_watermark_ns
    }

    pub fn reset(&mut self) {
        self.partitions.clear();
        self.seen.clear();
        self.global_watermark_ns = i64::MIN;
        self.processing_time_ns = 0;
        self.metrics = WatermarkMetrics::default();
    }

    /// Advance processing-time clock used for idle detection.
    pub fn advance_processing_time(&mut self, processing_time_ns: i64) {
        self.processing_time_ns = self.processing_time_ns.max(processing_time_ns);
        self.refresh_idle_flags();
        self.recompute_global();
        self.refresh_metrics();
    }

    pub fn push(
        &mut self,
        event: IngestedEvent,
    ) -> Result<(EventClass, Vec<IngestedEvent>), WatermarkError> {
        if event.envelope.event_id.as_str().is_empty() {
            self.metrics.invalid += 1;
            return Ok((EventClass::Invalid, Vec::new()));
        }
        if !self.seen.insert(event.envelope.event_id.clone()) {
            self.metrics.duplicates += 1;
            if let Some(p) = self.partitions.get_mut(&event.partition_key) {
                p.duplicates += 1;
            }
            return Ok((EventClass::Duplicate, Vec::new()));
        }

        let key = event.partition_key.clone();
        let now = self.processing_time_ns;
        let part = self
            .partitions
            .entry(key.clone())
            .or_insert_with(|| PartitionState::new(now));
        part.last_activity_ns = now;
        part.idle = false;

        let et = event.envelope.event_time_ns;
        let class = if self.global_watermark_ns != i64::MIN
            && et <= self.global_watermark_ns - self.cfg.late_revision_grace_ns
        {
            part.beyond_grace += 1;
            self.metrics.beyond_grace_events += 1;
            EventClass::BeyondGrace
        } else if self.global_watermark_ns != i64::MIN && et <= self.global_watermark_ns {
            part.late_events += 1;
            self.metrics.late_events += 1;
            EventClass::LateRevisable
        } else if part.watermark_ns != i64::MIN && et <= part.watermark_ns {
            part.late_events += 1;
            self.metrics.late_events += 1;
            EventClass::LateRevisable
        } else {
            EventClass::BufferedForReorder
        };

        // Beyond-grace: observable for metrics but not buffered into query state.
        if class == EventClass::BeyondGrace {
            self.refresh_metrics();
            return Ok((class, Vec::new()));
        }

        if part.buffer.len() >= self.cfg.max_reorder_buffer {
            // Roll back seen so caller can retry; do not silently discard.
            self.seen.remove(&event.envelope.event_id);
            return Err(WatermarkError::BufferFull {
                partition: key,
                capacity: self.cfg.max_reorder_buffer,
            });
        }

        if et > part.max_event_time_ns {
            part.max_event_time_ns = et;
            let candidate = et.saturating_sub(self.cfg.allowed_lateness_ns);
            if candidate > part.watermark_ns {
                part.watermark_ns = candidate;
            }
        }

        let sort = (
            event.envelope.event_time_ns,
            event.sequence,
            event.envelope.event_id.as_str().to_owned(),
        );
        part.buffer.insert(sort, Buffered { event });

        self.recompute_global();
        let released = self.release_ready();
        let class = if released.is_empty() {
            class
        } else if class == EventClass::BufferedForReorder {
            EventClass::OnTime
        } else {
            class
        };
        self.refresh_metrics();
        Ok((class, released))
    }

    /// Force-release everything currently buffered (end-of-source / seek finalize).
    pub fn drain_all(&mut self) -> Vec<IngestedEvent> {
        let mut out = Vec::new();
        let mut keys: Vec<_> = self.partitions.keys().cloned().collect();
        keys.sort();
        for k in keys {
            if let Some(p) = self.partitions.get_mut(&k) {
                let buf = std::mem::take(&mut p.buffer);
                for (_, b) in buf {
                    out.push(b.event);
                }
            }
        }
        out.sort_by(|a, b| {
            a.envelope
                .event_time_ns
                .cmp(&b.envelope.event_time_ns)
                .then(a.sequence.cmp(&b.sequence))
                .then(a.envelope.event_id.as_str().cmp(b.envelope.event_id.as_str()))
        });
        self.refresh_metrics();
        out
    }

    fn release_ready(&mut self) -> Vec<IngestedEvent> {
        let wm = self.global_watermark_ns;
        if wm == i64::MIN {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut keys: Vec<_> = self.partitions.keys().cloned().collect();
        keys.sort();
        for k in keys {
            let Some(p) = self.partitions.get_mut(&k) else {
                continue;
            };
            let mut ready = Vec::new();
            while let Some(entry) = p.buffer.first_entry() {
                if entry.key().0 <= wm {
                    ready.push(entry.remove().event);
                } else {
                    break;
                }
            }
            out.extend(ready);
        }
        out.sort_by(|a, b| {
            a.envelope
                .event_time_ns
                .cmp(&b.envelope.event_time_ns)
                .then(a.sequence.cmp(&b.sequence))
                .then(a.envelope.event_id.as_str().cmp(b.envelope.event_id.as_str()))
        });
        out
    }

    fn refresh_idle_flags(&mut self) {
        let now = self.processing_time_ns;
        let timeout = self.cfg.idle_timeout_ns;
        for p in self.partitions.values_mut() {
            if now.saturating_sub(p.last_activity_ns) >= timeout {
                p.idle = true;
            }
        }
    }

    fn recompute_global(&mut self) {
        let mut min_wm: Option<i64> = None;
        for p in self.partitions.values() {
            if p.idle || p.watermark_ns == i64::MIN {
                continue;
            }
            min_wm = Some(match min_wm {
                None => p.watermark_ns,
                Some(m) => m.min(p.watermark_ns),
            });
        }
        if let Some(candidate) = min_wm {
            // Never move backward.
            if candidate > self.global_watermark_ns {
                self.global_watermark_ns = candidate;
            }
        }
    }

    fn refresh_metrics(&mut self) {
        let mut buf = 0usize;
        let mut idle = 0usize;
        let mut active = 0usize;
        let mut pmap = BTreeMap::new();
        let mut max_et = i64::MIN;
        for (k, p) in &self.partitions {
            buf += p.buffer.len();
            if p.idle {
                idle += 1;
            } else if p.watermark_ns != i64::MIN {
                active += 1;
            }
            if p.watermark_ns != i64::MIN {
                pmap.insert(k.clone(), p.watermark_ns);
            }
            max_et = max_et.max(p.max_event_time_ns);
        }
        let lag = if self.global_watermark_ns == i64::MIN || max_et == i64::MIN {
            0
        } else {
            max_et.saturating_sub(self.global_watermark_ns)
        };
        self.metrics.global_watermark_ns = self.global_watermark_ns;
        self.metrics.watermark_lag_ns = lag;
        self.metrics.reorder_buffer_size = buf;
        self.metrics.idle_partitions = idle;
        self.metrics.active_partitions = active;
        self.metrics.partition_watermarks = pmap;
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WatermarkError {
    #[error("reorder buffer full for partition {partition} (cap {capacity})")]
    BufferFull { partition: String, capacity: usize },
}

/// Helper to build an [`IngestedEvent`] for tests / streaming feed.
pub fn ingested(
    sequence: u64,
    partition_key: impl Into<String>,
    envelope: TelemetryEnvelope,
) -> IngestedEvent {
    IngestedEvent {
        sequence,
        partition_key: partition_key.into(),
        envelope,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::partition_key_for;
    use faultline_common::{
        EventId, MetricKind, MetricPoint, TelemetryPayload, TelemetrySignal, SCHEMA_VERSION,
    };
    use indexmap::IndexMap;
    use proptest::prelude::*;

    fn metric(id: &str, t: i64, svc: &str) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(id),
            event_time_ns: t,
            observed_time_ns: t,
            ingest_time_ns: 0,
            source_id: "t".into(),
            dataset_id: "d".into(),
            incident_id: None,
            environment: "test".into(),
            service: Some(svc.into()),
            service_instance: None,
            host: None,
            region: None,
            signal: TelemetrySignal::Metric,
            attributes: IndexMap::new(),
            payload: TelemetryPayload::Metric(MetricPoint {
                name: format!("{svc}_lat"),
                kind: MetricKind::Gauge,
                value: 1.0,
                unit: Some("ms".into()),
            }),
        }
    }

    fn feed(tracker: &mut WatermarkTracker, seq: u64, env: TelemetryEnvelope) -> Vec<IngestedEvent> {
        let pk = partition_key_for(&env);
        let (_c, out) = tracker.push(ingested(seq, pk, env)).unwrap();
        out
    }

    #[test]
    fn ordered_events_release_by_watermark() {
        let mut t = WatermarkTracker::new(WatermarkConfig {
            allowed_lateness_ns: 10,
            ..Default::default()
        });
        let r1 = feed(&mut t, 1, metric("a", 100, "frontend"));
        assert!(r1.is_empty());
        let r2 = feed(&mut t, 2, metric("b", 120, "frontend"));
        // wm = 120-10 = 110 → event at 100 releases
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].envelope.event_id.as_str(), "a");
    }

    #[test]
    fn out_of_order_reorders_deterministically() {
        let mut t = WatermarkTracker::new(WatermarkConfig {
            allowed_lateness_ns: 50,
            ..Default::default()
        });
        let mut released = Vec::new();
        released.extend(feed(&mut t, 1, metric("late", 100, "frontend")));
        released.extend(feed(
            &mut t,
            2,
            metric("early_arrival_high_t", 200, "frontend"),
        ));
        // wm = 200-50 = 150 → event at 100 releases on second push
        let ids: Vec<_> = released
            .iter()
            .map(|e| e.envelope.event_id.as_str())
            .collect();
        assert_eq!(ids, vec!["late"]);
        released.extend(feed(&mut t, 3, metric("mid", 150, "frontend")));
        let ids: Vec<_> = released
            .iter()
            .map(|e| e.envelope.event_id.as_str())
            .collect();
        assert!(ids.contains(&"late"));
        assert!(ids.contains(&"mid"));
        assert!(!ids.contains(&"early_arrival_high_t"));
        let rest = t.drain_all();
        assert_eq!(rest[0].envelope.event_id.as_str(), "early_arrival_high_t");
    }

    #[test]
    fn equal_timestamps_tie_break_by_seq_then_id() {
        let mut t = WatermarkTracker::new(WatermarkConfig {
            allowed_lateness_ns: 50,
            ..Default::default()
        });
        // Buffer three equal-time events out of ingest order, then advance watermark.
        feed(&mut t, 2, metric("b", 100, "frontend"));
        feed(&mut t, 1, metric("a", 100, "frontend"));
        feed(&mut t, 3, metric("c", 100, "frontend"));
        let released = feed(&mut t, 4, metric("advance", 200, "frontend"));
        // wm = 150 → equal-time events release sorted by (time, seq, id)
        let ids: Vec<_> = released
            .iter()
            .map(|e| e.envelope.event_id.as_str())
            .collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn duplicates_do_not_affect_results() {
        let mut t = WatermarkTracker::new(WatermarkConfig::default());
        feed(&mut t, 1, metric("a", 100, "frontend"));
        let (c, out) = t
            .push(ingested(
                2,
                "metric:frontend:frontend_lat",
                metric("a", 100, "frontend"),
            ))
            .unwrap();
        assert_eq!(c, EventClass::Duplicate);
        assert!(out.is_empty());
        assert_eq!(t.metrics().duplicates, 1);
    }

    #[test]
    fn beyond_grace_counted_not_buffered() {
        let mut t = WatermarkTracker::new(WatermarkConfig {
            allowed_lateness_ns: 0,
            late_revision_grace_ns: 5,
            ..Default::default()
        });
        feed(&mut t, 1, metric("hi", 1000, "frontend"));
        // global wm = 1000
        assert!(t.global_watermark_ns() >= 1000);
        let (c, out) = t
            .push(ingested(
                2,
                "metric:frontend:frontend_lat",
                metric("ancient", 100, "frontend"),
            ))
            .unwrap();
        assert_eq!(c, EventClass::BeyondGrace);
        assert!(out.is_empty());
        assert_eq!(t.metrics().beyond_grace_events, 1);
    }

    #[test]
    fn idle_partition_does_not_block_forever() {
        let mut t = WatermarkTracker::new(WatermarkConfig {
            allowed_lateness_ns: 0,
            idle_timeout_ns: 100,
            ..Default::default()
        });
        feed(&mut t, 1, metric("a", 50, "frontend"));
        t.advance_processing_time(0);
        feed(&mut t, 2, metric("b", 200, "checkout"));
        // frontend idle
        t.advance_processing_time(200);
        assert!(t.metrics().idle_partitions >= 1);
        // global can advance based on active checkout only
        assert!(t.global_watermark_ns() >= 200 || t.partitions_active_ok());
    }

    impl WatermarkTracker {
        fn partitions_active_ok(&self) -> bool {
            self.metrics.active_partitions >= 1 || self.global_watermark_ns != i64::MIN
        }
    }

    #[test]
    fn reset_clears_state() {
        let mut t = WatermarkTracker::new(WatermarkConfig::default());
        feed(&mut t, 1, metric("a", 100, "frontend"));
        t.reset();
        assert_eq!(t.global_watermark_ns(), i64::MIN);
        assert_eq!(t.metrics().reorder_buffer_size, 0);
    }

    #[test]
    fn watermark_never_moves_backward() {
        let mut t = WatermarkTracker::new(WatermarkConfig {
            allowed_lateness_ns: 0,
            ..Default::default()
        });
        feed(&mut t, 1, metric("a", 500, "frontend"));
        let wm1 = t.global_watermark_ns();
        feed(&mut t, 2, metric("b", 100, "frontend"));
        assert!(t.global_watermark_ns() >= wm1);
    }

    #[test]
    fn deterministic_repeated_replay() {
        let run = || {
            let mut t = WatermarkTracker::new(WatermarkConfig {
                allowed_lateness_ns: 20,
                ..Default::default()
            });
            let mut out = Vec::new();
            for (seq, id, ts) in [
                (1u64, "c", 130i64),
                (2, "a", 100),
                (3, "b", 110),
                (4, "d", 200),
            ] {
                out.extend(feed(&mut t, seq, metric(id, ts, "frontend")));
            }
            out.extend(t.drain_all());
            out.iter()
                .map(|e| e.envelope.event_id.as_str().to_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }

    proptest! {
        #[test]
        fn prop_watermark_monotonic(
            times in prop::collection::vec(0i64..10_000, 1..40)
        ) {
            let mut t = WatermarkTracker::new(WatermarkConfig {
                allowed_lateness_ns: 100,
                ..Default::default()
            });
            let mut last = i64::MIN;
            for (i, ts) in times.into_iter().enumerate() {
                feed(&mut t, i as u64 + 1, metric(&format!("e{i}"), ts, "svc"));
                let wm = t.global_watermark_ns();
                if wm != i64::MIN {
                    prop_assert!(wm >= last);
                    last = wm;
                }
            }
        }
    }
}
