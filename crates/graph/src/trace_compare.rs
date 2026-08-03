//! Healthy trace matching and failed-vs-healthy comparison (TA-036/037,
//! spec 17.4 + 20.5).
//!
//! Cohort selection: same entry operation, similar service path, nearest in
//! time before the incident. The reference is the median healthy trace of the
//! cohort, never a cherry-picked single trace. Alignment is by (service,
//! operation, causal path), never array index.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::critical_path::critical_path;
use crate::trace_graph::{TraceDag, TraceSpanNode};
use faultline_common::SpanStatus;

/// Maximum cohort size considered for the median reference.
const COHORT_CAP: usize = 20;
/// Minimum service-set similarity for a healthy trace to join the cohort.
const MIN_PATH_SIMILARITY: f64 = 0.5;
/// Cohort size at which the size component of confidence saturates.
const CONFIDENCE_SATURATION: usize = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CohortMatch {
    pub failed_trace_id: String,
    pub entry_operation: String,
    pub cohort_trace_ids: Vec<String>,
    /// Trace whose envelope duration is the cohort median.
    pub median_trace_id: Option<String>,
    /// [0, 1]: path similarity x cohort size saturation.
    pub confidence: f64,
}

/// One aligned span pair (or one-sided presence).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpanDelta {
    pub service: Option<String>,
    pub operation: String,
    /// Causal path key used for alignment.
    pub path_key: String,
    pub failed_span_id: Option<String>,
    pub healthy_span_id: Option<String>,
    pub failed_duration_ns: Option<i64>,
    pub healthy_duration_ns: Option<i64>,
    /// failed - healthy when both sides exist.
    pub delta_ns: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceComparison {
    pub failed_trace_id: String,
    pub healthy_trace_id: String,
    pub comparable_confidence: f64,
    /// failed envelope - healthy envelope.
    pub total_excess_ns: i64,
    pub failed_critical_ns: i64,
    pub healthy_critical_ns: i64,
    pub critical_path_delta_ns: i64,
    pub aligned: Vec<SpanDelta>,
    pub added_services: Vec<String>,
    pub removed_services: Vec<String>,
}

fn root_of(dag: &TraceDag) -> Option<&TraceSpanNode> {
    dag.spans
        .iter()
        .filter(|s| s.parent_span_id.is_none() || s.missing_parent)
        .max_by(|a, b| {
            (a.end_time_ns - a.start_time_ns)
                .cmp(&(b.end_time_ns - b.start_time_ns))
                .then_with(|| b.span_id.cmp(&a.span_id))
        })
}

fn envelope_ns(dag: &TraceDag) -> i64 {
    root_of(dag)
        .map(|r| (r.end_time_ns - r.start_time_ns).max(0))
        .unwrap_or(0)
}

fn service_set(dag: &TraceDag) -> BTreeSet<String> {
    dag.spans.iter().filter_map(|s| s.service.clone()).collect()
}

fn is_healthy(dag: &TraceDag) -> bool {
    dag.spans.iter().all(|s| s.status != SpanStatus::Error)
}

fn jaccard(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let inter = a.intersection(b).count() as f64;
    let union = a.union(b).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// Select the healthy reference cohort for a failed trace (TA-036).
pub fn match_healthy_cohort(
    all: &[TraceDag],
    failed: &TraceDag,
    incident_onset_ns: Option<i64>,
) -> CohortMatch {
    let entry_operation = root_of(failed)
        .map(|r| r.operation.clone())
        .unwrap_or_default();
    let failed_services = service_set(failed);

    // (similarity, start_ns, trace_id, envelope)
    let mut candidates: Vec<(f64, i64, String, i64)> = Vec::new();
    for dag in all {
        if dag.trace_id == failed.trace_id || !is_healthy(dag) {
            continue;
        }
        let Some(root) = root_of(dag) else { continue };
        if root.operation != entry_operation {
            continue;
        }
        if let Some(onset) = incident_onset_ns {
            if root.start_time_ns >= onset {
                continue;
            }
        }
        let sim = jaccard(&failed_services, &service_set(dag));
        if sim < MIN_PATH_SIMILARITY {
            continue;
        }
        candidates.push((
            sim,
            root.start_time_ns,
            dag.trace_id.clone(),
            envelope_ns(dag),
        ));
    }

    // Nearest before incident first (latest start), deterministic tie-break.
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
    candidates.truncate(COHORT_CAP);

    let median_trace_id = if candidates.is_empty() {
        None
    } else {
        let mut by_duration: Vec<(i64, &str)> = candidates
            .iter()
            .map(|(_, _, id, env)| (*env, id.as_str()))
            .collect();
        by_duration.sort();
        Some(by_duration[by_duration.len() / 2].1.to_owned())
    };

    let avg_sim = if candidates.is_empty() {
        0.0
    } else {
        candidates.iter().map(|(s, ..)| *s).sum::<f64>() / candidates.len() as f64
    };
    let size_factor = (candidates.len() as f64 / CONFIDENCE_SATURATION as f64).clamp(0.0, 1.0);
    let confidence = avg_sim * size_factor;

    CohortMatch {
        failed_trace_id: failed.trace_id.clone(),
        entry_operation,
        cohort_trace_ids: candidates.into_iter().map(|(_, _, id, _)| id).collect(),
        median_trace_id,
        confidence,
    }
}

/// Alignment key: service, operation, and the causal path of (service,
/// operation) pairs from the root - never the array index.
fn path_keys(dag: &TraceDag) -> BTreeMap<String, Vec<&TraceSpanNode>> {
    let by_id: BTreeMap<&str, &TraceSpanNode> =
        dag.spans.iter().map(|s| (s.span_id.as_str(), s)).collect();
    let mut out: BTreeMap<String, Vec<&TraceSpanNode>> = BTreeMap::new();
    for span in &dag.spans {
        let mut path = Vec::new();
        let mut current = Some(span);
        let mut hops = 0;
        while let Some(node) = current {
            path.push(format!(
                "{}:{}",
                node.service.as_deref().unwrap_or("?"),
                node.operation
            ));
            current = node
                .parent_span_id
                .as_deref()
                .and_then(|p| by_id.get(p).copied());
            hops += 1;
            if hops > dag.spans.len() {
                break; // cycle guard
            }
        }
        path.reverse();
        out.entry(path.join(" > ")).or_default().push(span);
    }
    out
}

/// Compare a failed trace against a healthy reference (TA-037 backend).
pub fn compare_traces(
    failed: &TraceDag,
    healthy: &TraceDag,
    comparable_confidence: f64,
) -> TraceComparison {
    let failed_keys = path_keys(failed);
    let healthy_keys = path_keys(healthy);

    let mut aligned = Vec::new();
    let mut all_keys: BTreeSet<&String> = failed_keys.keys().collect();
    all_keys.extend(healthy_keys.keys());
    for key in all_keys {
        let f_spans = failed_keys.get(key).cloned().unwrap_or_default();
        let h_spans = healthy_keys.get(key).cloned().unwrap_or_default();
        let n = f_spans.len().max(h_spans.len());
        for i in 0..n {
            let f = f_spans.get(i);
            let h = h_spans.get(i);
            let sample = f.or(h).expect("one side present");
            aligned.push(SpanDelta {
                service: sample.service.clone(),
                operation: sample.operation.clone(),
                path_key: key.clone(),
                failed_span_id: f.map(|s| s.span_id.clone()),
                healthy_span_id: h.map(|s| s.span_id.clone()),
                failed_duration_ns: f.map(|s| s.duration_ns),
                healthy_duration_ns: h.map(|s| s.duration_ns),
                delta_ns: match (f, h) {
                    (Some(f), Some(h)) => Some(f.duration_ns - h.duration_ns),
                    _ => None,
                },
            });
        }
    }
    aligned.sort_by(|a, b| {
        b.delta_ns
            .unwrap_or(i64::MAX)
            .cmp(&a.delta_ns.unwrap_or(i64::MAX))
            .then_with(|| a.path_key.cmp(&b.path_key))
    });

    let failed_services = service_set(failed);
    let healthy_services = service_set(healthy);
    let failed_critical = critical_path(failed)
        .map(|c| c.critical_duration_ns)
        .unwrap_or(0);
    let healthy_critical = critical_path(healthy)
        .map(|c| c.critical_duration_ns)
        .unwrap_or(0);

    TraceComparison {
        failed_trace_id: failed.trace_id.clone(),
        healthy_trace_id: healthy.trace_id.clone(),
        comparable_confidence,
        total_excess_ns: envelope_ns(failed) - envelope_ns(healthy),
        failed_critical_ns: failed_critical,
        healthy_critical_ns: healthy_critical,
        critical_path_delta_ns: failed_critical - healthy_critical,
        aligned,
        added_services: failed_services
            .difference(&healthy_services)
            .cloned()
            .collect(),
        removed_services: healthy_services
            .difference(&failed_services)
            .cloned()
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace_graph::TraceStore;
    use faultline_common::{
        EventId, SpanEvent, SpanKind, TelemetryEnvelope, TelemetryPayload, TelemetrySignal,
        SCHEMA_VERSION,
    };
    use indexmap::IndexMap;

    #[allow(clippy::too_many_arguments)]
    fn span_env(
        service: &str,
        trace: &str,
        span_id: &str,
        parent: Option<&str>,
        op: &str,
        start: i64,
        end: i64,
        status: SpanStatus,
    ) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(format!("e-{trace}-{span_id}")),
            event_time_ns: start,
            observed_time_ns: start,
            ingest_time_ns: start,
            source_id: "t".into(),
            dataset_id: "t".into(),
            incident_id: None,
            environment: "t".into(),
            service: Some(service.into()),
            service_instance: None,
            host: None,
            region: None,
            signal: TelemetrySignal::Span,
            attributes: IndexMap::new(),
            payload: TelemetryPayload::Span(SpanEvent {
                trace_id: trace.into(),
                span_id: span_id.into(),
                parent_span_id: parent.map(str::to_owned),
                operation: op.into(),
                start_time_ns: start,
                end_time_ns: end,
                duration_ns: end - start,
                status,
                peer_service: None,
                span_kind: SpanKind::Server,
            }),
        }
    }

    /// Build N healthy traces at t, t+step... plus one failed trace after
    /// onset with inflated backend duration.
    fn store() -> TraceStore {
        let mut s = TraceStore::new();
        for i in 0..5i64 {
            let base = i * 1_000;
            let tr = format!("ok-{i}");
            s.ingest_envelope(&span_env(
                "frontend",
                &tr,
                "a",
                None,
                "GET /",
                base,
                base + 100,
                SpanStatus::Ok,
            ));
            s.ingest_envelope(&span_env(
                "backend",
                &tr,
                "b",
                Some("a"),
                "query",
                base + 10,
                base + 60,
                SpanStatus::Ok,
            ));
        }
        let base = 10_000;
        s.ingest_envelope(&span_env(
            "frontend",
            "bad",
            "a",
            None,
            "GET /",
            base,
            base + 400,
            SpanStatus::Error,
        ));
        s.ingest_envelope(&span_env(
            "backend",
            "bad",
            "b",
            Some("a"),
            "query",
            base + 10,
            base + 380,
            SpanStatus::Error,
        ));
        s
    }

    #[test]
    fn cohort_matches_entry_operation_and_health() {
        let s = store();
        let dags = s.all_dags();
        let failed = s.get("bad").unwrap();
        let m = match_healthy_cohort(&dags, &failed, Some(9_000));
        assert_eq!(m.cohort_trace_ids.len(), 5);
        assert!(m.median_trace_id.is_some());
        assert!(m.confidence > 0.9, "confidence {}", m.confidence);
        assert_eq!(m.entry_operation, "GET /");
    }

    #[test]
    fn cohort_excludes_traces_after_onset() {
        let s = store();
        let dags = s.all_dags();
        let failed = s.get("bad").unwrap();
        let m = match_healthy_cohort(&dags, &failed, Some(2_500));
        // Only ok-0, ok-1, ok-2 start before 2500.
        assert_eq!(m.cohort_trace_ids.len(), 3);
    }

    #[test]
    fn comparison_aligns_by_path_not_index() {
        let s = store();
        let failed = s.get("bad").unwrap();
        let healthy = s.get("ok-0").unwrap();
        let c = compare_traces(&failed, &healthy, 1.0);
        assert_eq!(c.total_excess_ns, 300);
        assert_eq!(c.critical_path_delta_ns, 300);
        // Backend query delta = 370 - 50 = 320, ranked first (largest).
        let top = &c.aligned[0];
        assert_eq!(top.service.as_deref(), Some("backend"));
        assert_eq!(top.delta_ns, Some(320));
        assert!(top.path_key.contains("frontend:GET /"));
        assert!(c.added_services.is_empty());
        assert!(c.removed_services.is_empty());
    }

    #[test]
    fn empty_cohort_when_no_healthy_match() {
        let mut s = TraceStore::new();
        s.ingest_envelope(&span_env(
            "frontend",
            "bad",
            "a",
            None,
            "GET /",
            0,
            100,
            SpanStatus::Error,
        ));
        let dags = s.all_dags();
        let failed = s.get("bad").unwrap();
        let m = match_healthy_cohort(&dags, &failed, None);
        assert!(m.cohort_trace_ids.is_empty());
        assert_eq!(m.median_trace_id, None);
        assert_eq!(m.confidence, 0.0);
    }

    #[test]
    fn deterministic() {
        let s = store();
        let dags = s.all_dags();
        let failed = s.get("bad").unwrap();
        let healthy = s.get("ok-2").unwrap();
        let a = serde_json::to_string(&(
            match_healthy_cohort(&dags, &failed, Some(9_000)),
            compare_traces(&failed, &healthy, 0.8),
        ))
        .unwrap();
        let b = serde_json::to_string(&(
            match_healthy_cohort(&dags, &failed, Some(9_000)),
            compare_traces(&failed, &healthy, 0.8),
        ))
        .unwrap();
        assert_eq!(a, b);
    }
}
