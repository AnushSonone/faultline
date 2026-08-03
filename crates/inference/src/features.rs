//! Root-cause candidate features (TA-031, spec 18.3).
//!
//! Every feature is a deterministic function of the envelope stream and is
//! normalized into [0, 1]. Ground-truth labels are never an input here.
//!
//! Terminology: edges in the service graph run caller -> callee. A fault in a
//! callee propagates to its transitive *callers*, so the "downstream impact"
//! set of a candidate is its reverse-reachable caller set. This matches the
//! fixture's `expected_downstream_services` semantics.
//!
//! `critical_path_contribution` (TA-035): each trace's real critical path is
//! computed; a service's excess is its critical-path time in failed traces
//! beyond its mean critical-path time in healthy traces, as a share of total
//! excess across services.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use faultline_common::{SpanStatus, TelemetryEnvelope, TelemetryPayload};
use faultline_graph::{critical_path, ServiceGraph, TraceStore};
use serde::{Deserialize, Serialize};

use crate::anomaly::{onset_by_service, AnomalyConfig, AnomalyDetector, AnomalyInterval};
use crate::baseline::{SeriesKey, Z_SATURATION};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct FeatureConfig {
    pub anomaly: AnomalyConfig,
    /// How far before a service's anomaly onset a change event still counts
    /// as "nearby".
    pub change_window_ns: i64,
    /// Half-width of the window around onset in which high-severity logs
    /// count as evidence.
    pub log_window_ns: i64,
    /// Log count at which `log_evidence` saturates to 1.0.
    pub log_saturation_count: u64,
}

impl Default for FeatureConfig {
    fn default() -> Self {
        Self {
            anomaly: AnomalyConfig::default(),
            change_window_ns: 600_000_000_000, // 10 minutes
            log_window_ns: 60_000_000_000,     // 1 minute
            log_saturation_count: 3,
        }
    }
}

/// Feature vector for one candidate service, with the raw observations that
/// produced each feature retained for evidence objects (TA-033).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CandidateFeatures {
    pub service: String,
    // Spec 18.3 features A..J, all in [0, 1].
    pub anomaly_strength: f64,
    pub temporal_precedence: f64,
    pub failed_trace_coverage: f64,
    pub critical_path_contribution: f64,
    pub downstream_impact: f64,
    pub topology_consistency: f64,
    pub change_proximity: f64,
    pub log_evidence: f64,
    pub persistence: f64,
    pub contradiction_penalty: f64,
    // Supporting detail.
    pub onset_ns: Option<i64>,
    pub peak_abs_z: f64,
    pub anomaly_refs: Vec<String>,
    pub change_refs: Vec<String>,
    pub log_refs: Vec<String>,
    pub failed_trace_ids: Vec<String>,
    pub impacted_anomalous: Vec<String>,
    /// Impacted (transitive caller) services whose anomaly onset precedes this
    /// candidate's: evidence against this candidate being the cause.
    pub preceding_impacted: Vec<String>,
}

/// Output of the feature stage: everything ranking and evidence need.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FeatureSet {
    pub candidates: Vec<CandidateFeatures>,
    pub anomaly_intervals: Vec<AnomalyInterval>,
    /// Earliest anomaly onset across all services, if any.
    pub incident_onset_ns: Option<i64>,
    /// Latest anomaly interval end across all services, if any.
    pub incident_end_ns: Option<i64>,
}

/// Compute candidate features from an envelope stream sorted by
/// `(event_time_ns, event_id)` (the replay reader's order).
pub fn compute_features(envelopes: &[TelemetryEnvelope], config: &FeatureConfig) -> FeatureSet {
    // 1. Robust baselines + anomaly intervals over metric series.
    let mut detector = AnomalyDetector::new(config.anomaly);
    for env in envelopes {
        let (Some(service), TelemetryPayload::Metric(m)) = (env.service.as_deref(), &env.payload)
        else {
            continue;
        };
        let key = SeriesKey {
            service: service.to_owned(),
            metric: m.name.clone(),
        };
        detector.observe(&key, env.event_time_ns, m.value, env.event_id.as_str());
    }
    let intervals = detector.finish();
    let onsets = onset_by_service(&intervals);
    let incident_onset_ns = onsets.values().copied().min();
    let incident_end_ns = intervals.iter().map(|iv| iv.end_ns).max();

    // 2. Graph + traces from the full stream.
    let mut graph = ServiceGraph::new();
    let mut traces = TraceStore::new();
    for env in envelopes {
        graph.ingest_envelope(env);
        traces.ingest_envelope(env);
    }
    let snapshot = graph.snapshot();

    // Candidate universe: every service seen anywhere, deterministic order.
    let mut services: BTreeSet<String> = snapshot.nodes.iter().map(|n| n.service.clone()).collect();
    for env in envelopes {
        if let Some(s) = env.service.as_deref() {
            services.insert(s.to_owned());
        }
    }

    // Reverse adjacency: callee -> callers.
    let mut callers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for edge in &snapshot.edges {
        callers
            .entry(edge.to.as_str())
            .or_default()
            .push(edge.from.as_str());
    }

    // 3. Trace-level aggregates on real critical paths (TA-035).
    let dags = traces.all_dags();
    let mut failed_trace_ids: Vec<&str> = Vec::new();
    // Per-trace critical contribution by service.
    let mut trace_critical: BTreeMap<&str, BTreeMap<String, i64>> = BTreeMap::new();
    let mut healthy_crit_sum: BTreeMap<String, (f64, u64)> = BTreeMap::new();
    for dag in &dags {
        let contrib = critical_path(dag)
            .map(|cp| cp.service_contribution_ns)
            .unwrap_or_default();
        let failed = dag.spans.iter().any(|s| s.status == SpanStatus::Error);
        if failed {
            failed_trace_ids.push(dag.trace_id.as_str());
        } else {
            for (svc, ns) in &contrib {
                let e = healthy_crit_sum.entry(svc.clone()).or_default();
                e.0 += *ns as f64;
                e.1 += 1;
            }
        }
        trace_critical.insert(dag.trace_id.as_str(), contrib);
    }
    failed_trace_ids.sort_unstable();
    let healthy_mean: BTreeMap<&str, f64> = healthy_crit_sum
        .iter()
        .map(|(svc, (sum, n))| (svc.as_str(), if *n == 0 { 0.0 } else { sum / *n as f64 }))
        .collect();

    // Per-service presence and excess critical-path time in failed traces:
    // how much of each failed trace's critical path a service holds beyond
    // its healthy-trace critical baseline.
    let mut coverage: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut excess: BTreeMap<String, f64> = BTreeMap::new();
    for dag in &dags {
        if failed_trace_ids
            .binary_search(&dag.trace_id.as_str())
            .is_err()
        {
            continue;
        }
        for span in &dag.spans {
            if let Some(svc) = span.service.as_deref() {
                coverage
                    .entry(svc.to_owned())
                    .or_default()
                    .insert(dag.trace_id.clone());
            }
        }
        if let Some(contrib) = trace_critical.get(dag.trace_id.as_str()) {
            for (svc, ns) in contrib {
                let mean = healthy_mean.get(svc.as_str()).copied().unwrap_or(0.0);
                let over = *ns as f64 - mean;
                if over > 0.0 {
                    *excess.entry(svc.clone()).or_default() += over;
                }
            }
        }
    }
    let total_excess: f64 = excess.values().sum();

    // 4. Change and log indexes.
    struct ChangeRef<'a> {
        service: &'a str,
        time_ns: i64,
        event_id: &'a str,
    }
    struct LogRef<'a> {
        service: &'a str,
        time_ns: i64,
        event_id: &'a str,
    }
    let mut changes: Vec<ChangeRef> = Vec::new();
    let mut error_logs: Vec<LogRef> = Vec::new();
    for env in envelopes {
        let Some(service) = env.service.as_deref() else {
            continue;
        };
        match &env.payload {
            TelemetryPayload::Change(_) => changes.push(ChangeRef {
                service,
                time_ns: env.event_time_ns,
                event_id: env.event_id.as_str(),
            }),
            TelemetryPayload::Log(log) => {
                let severe_text = log
                    .severity_text
                    .as_deref()
                    .map(|t| t.eq_ignore_ascii_case("error") || t.eq_ignore_ascii_case("fatal"))
                    .unwrap_or(false);
                let severe_num = log.severity_number.map(|n| n >= 17).unwrap_or(false);
                if severe_text || severe_num {
                    error_logs.push(LogRef {
                        service,
                        time_ns: env.event_time_ns,
                        event_id: env.event_id.as_str(),
                    });
                }
            }
            _ => {}
        }
    }

    // 5. Precedence ranks: number of anomalous services with strictly earlier
    // onset (competition ranking, deterministic under ties).
    let anomalous_count = onsets.len();
    let rank_of = |service: &str| -> Option<usize> {
        let own = *onsets.get(service)?;
        Some(onsets.values().filter(|t| **t < own).count())
    };

    // 6. Assemble per-candidate features.
    let n_services = services.len();
    let mut candidates = Vec::with_capacity(n_services);
    for service in &services {
        let onset = onsets.get(service).copied();
        let service_intervals: Vec<&AnomalyInterval> = intervals
            .iter()
            .filter(|iv| iv.service == *service)
            .collect();
        let peak_abs_z = service_intervals
            .iter()
            .map(|iv| iv.peak_abs_z)
            .fold(0.0, f64::max);
        let anomaly_refs: Vec<String> = service_intervals
            .iter()
            .flat_map(|iv| iv.source_refs.iter().cloned())
            .collect();

        // A. anomaly_strength
        let anomaly_strength = (peak_abs_z / Z_SATURATION).clamp(0.0, 1.0);

        // B. temporal_precedence
        let temporal_precedence = match rank_of(service) {
            None => 0.0,
            Some(_) if anomalous_count <= 1 => 1.0,
            Some(rank) => 1.0 - rank as f64 / (anomalous_count - 1) as f64,
        };

        // C. failed_trace_coverage
        let covered = coverage.get(service).map(BTreeSet::len).unwrap_or(0);
        let failed_trace_coverage = if failed_trace_ids.is_empty() {
            0.0
        } else {
            covered as f64 / failed_trace_ids.len() as f64
        };

        // D. critical_path_contribution (real critical-path attribution, TA-035)
        let critical_path_contribution = if total_excess > 0.0 {
            excess.get(service).copied().unwrap_or(0.0) / total_excess
        } else {
            0.0
        };

        // Reverse reachability: transitive callers of this candidate.
        let impacted = reverse_reachable(&callers, service);
        let impacted_anomalous: Vec<String> = impacted
            .iter()
            .filter(|s| onsets.contains_key(**s))
            .map(|s| (*s).to_owned())
            .collect();
        let other_anomalous: Vec<&String> = onsets
            .keys()
            .filter(|s| s.as_str() != service.as_str())
            .collect();

        // E. downstream_impact: breadth of anomalous impact over the system.
        let downstream_impact = if n_services > 1 {
            impacted_anomalous.len() as f64 / (n_services - 1) as f64
        } else {
            0.0
        };

        // F. topology_consistency: how much of the anomalous set the
        // dependency graph explains from this candidate.
        let topology_consistency = if other_anomalous.is_empty() {
            0.0
        } else {
            impacted_anomalous.len() as f64 / other_anomalous.len() as f64
        };

        // G. change_proximity: nearest change on this service at or before
        // its onset (or the incident onset when the candidate never became
        // anomalous itself).
        let onset_ref = onset.or(incident_onset_ns);
        let mut change_refs: Vec<String> = Vec::new();
        let mut change_proximity: f64 = 0.0;
        if let Some(t0) = onset_ref {
            for ch in changes.iter().filter(|c| c.service == service.as_str()) {
                let delay = t0 - ch.time_ns;
                if delay >= 0 && delay <= config.change_window_ns {
                    let proximity = 1.0 - delay as f64 / config.change_window_ns as f64;
                    if proximity > change_proximity {
                        change_proximity = proximity;
                    }
                    change_refs.push(ch.event_id.to_owned());
                }
            }
        }
        change_refs.sort_unstable();

        // H. log_evidence: high-severity logs near onset.
        let mut log_refs: Vec<String> = Vec::new();
        if let Some(t0) = onset_ref {
            for lr in error_logs.iter().filter(|l| l.service == service.as_str()) {
                if (lr.time_ns - t0).abs() <= config.log_window_ns {
                    log_refs.push(lr.event_id.to_owned());
                }
            }
        }
        log_refs.sort_unstable();
        let log_evidence =
            (log_refs.len() as f64 / config.log_saturation_count.max(1) as f64).clamp(0.0, 1.0);

        // I. persistence: anomalous time share of the incident span.
        let persistence = match (incident_onset_ns, incident_end_ns) {
            (Some(t0), Some(t1)) if t1 > t0 => {
                let span = (t1 - t0) as f64;
                let mine: f64 = service_intervals
                    .iter()
                    .map(|iv| (iv.end_ns - iv.start_ns).max(0) as f64)
                    .sum();
                (mine / span).clamp(0.0, 1.0)
            }
            _ => 0.0,
        };

        // J. contradiction_penalty
        let mut preceding_impacted: Vec<String> = Vec::new();
        let contradiction_penalty = match onset {
            None if anomalous_count > 0 => 1.0,
            None => 0.0,
            Some(own) => {
                preceding_impacted = impacted_anomalous
                    .iter()
                    .filter(|s| onsets.get(*s).is_some_and(|t| *t < own))
                    .cloned()
                    .collect();
                if impacted_anomalous.is_empty() {
                    0.0
                } else {
                    preceding_impacted.len() as f64 / impacted_anomalous.len() as f64
                }
            }
        };

        candidates.push(CandidateFeatures {
            service: service.clone(),
            anomaly_strength,
            temporal_precedence,
            failed_trace_coverage,
            critical_path_contribution,
            downstream_impact,
            topology_consistency,
            change_proximity,
            log_evidence,
            persistence,
            contradiction_penalty,
            onset_ns: onset,
            peak_abs_z,
            anomaly_refs,
            change_refs,
            log_refs,
            failed_trace_ids: coverage
                .get(service)
                .map(|set| set.iter().cloned().collect())
                .unwrap_or_default(),
            impacted_anomalous,
            preceding_impacted,
        });
    }

    FeatureSet {
        candidates,
        anomaly_intervals: intervals,
        incident_onset_ns,
        incident_end_ns,
    }
}

/// Services that can reach `target` following caller -> callee edges, i.e.
/// the transitive callers that a fault in `target` can impact.
fn reverse_reachable<'a>(callers: &BTreeMap<&'a str, Vec<&'a str>>, target: &str) -> Vec<&'a str> {
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut queue: VecDeque<&str> = VecDeque::new();
    if let Some(direct) = callers.get(target) {
        for c in direct {
            if seen.insert(c) {
                queue.push_back(c);
            }
        }
    }
    while let Some(current) = queue.pop_front() {
        if let Some(direct) = callers.get(current) {
            for c in direct {
                if seen.insert(c) {
                    queue.push_back(c);
                }
            }
        }
    }
    seen.into_iter().collect()
}

/// Shared scenario builders for this crate's tests (features, evidence graph).
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use faultline_common::{
        ChangeEvent, ChangeType, EventId, LogEvent, MetricKind, MetricPoint, SpanEvent, SpanKind,
        SpanStatus, TelemetrySignal, SCHEMA_VERSION,
    };
    use indexmap::IndexMap;

    pub(crate) fn envelope(
        service: &str,
        t: i64,
        signal: TelemetrySignal,
        payload: TelemetryPayload,
        id: &str,
    ) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(id.to_owned()),
            event_time_ns: t,
            observed_time_ns: t,
            ingest_time_ns: t,
            source_id: "test".into(),
            dataset_id: "test".into(),
            incident_id: None,
            environment: "test".into(),
            service: Some(service.into()),
            service_instance: None,
            host: None,
            region: None,
            signal,
            attributes: IndexMap::new(),
            payload,
        }
    }

    pub(crate) fn metric(service: &str, t: i64, value: f64, id: &str) -> TelemetryEnvelope {
        envelope(
            service,
            t,
            TelemetrySignal::Metric,
            TelemetryPayload::Metric(MetricPoint {
                name: format!("{service}_mem"),
                kind: MetricKind::Gauge,
                value,
                unit: None,
            }),
            id,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn span(
        service: &str,
        trace: &str,
        span_id: &str,
        parent: Option<&str>,
        t: i64,
        dur: i64,
        status: SpanStatus,
        id: &str,
    ) -> TelemetryEnvelope {
        envelope(
            service,
            t,
            TelemetrySignal::Span,
            TelemetryPayload::Span(SpanEvent {
                trace_id: trace.into(),
                span_id: span_id.into(),
                parent_span_id: parent.map(str::to_owned),
                operation: "op".into(),
                start_time_ns: t,
                end_time_ns: t + dur,
                duration_ns: dur,
                status,
                peer_service: None,
                span_kind: SpanKind::Server,
            }),
            id,
        )
    }

    /// frontend -> backend call graph; backend goes anomalous first, then
    /// frontend; deploy lands on backend right before its onset.
    pub(crate) fn scenario() -> Vec<TelemetryEnvelope> {
        let mut envs = Vec::new();
        let sec = 1_000_000_000i64;
        for i in 0..20 {
            let t = i * sec;
            let backend_v = if i >= 8 {
                900.0
            } else {
                100.0 + (i % 3) as f64
            };
            let frontend_v = if i >= 11 {
                700.0
            } else {
                50.0 + (i % 3) as f64
            };
            envs.push(metric("backend", t, backend_v, &format!("mb{i}")));
            envs.push(metric("frontend", t, frontend_v, &format!("mf{i}")));
        }
        // Healthy traces before onset, failed traces after.
        for i in 0..4 {
            let t = i * sec;
            let tr = format!("tr-ok-{i}");
            envs.push(span(
                "frontend",
                &tr,
                &format!("{tr}-a"),
                None,
                t,
                10_000,
                SpanStatus::Ok,
                &format!("sf{i}"),
            ));
            envs.push(span(
                "backend",
                &tr,
                &format!("{tr}-b"),
                Some(&format!("{tr}-a")),
                t,
                5_000,
                SpanStatus::Ok,
                &format!("sb{i}"),
            ));
        }
        for i in 0..4 {
            let t = (12 + i) * sec;
            let tr = format!("tr-bad-{i}");
            envs.push(span(
                "frontend",
                &tr,
                &format!("{tr}-a"),
                None,
                t,
                50_000,
                SpanStatus::Error,
                &format!("xf{i}"),
            ));
            envs.push(span(
                "backend",
                &tr,
                &format!("{tr}-b"),
                Some(&format!("{tr}-a")),
                t,
                45_000,
                SpanStatus::Error,
                &format!("xb{i}"),
            ));
        }
        envs.push(envelope(
            "backend",
            7 * sec + sec / 2,
            TelemetrySignal::Deployment,
            TelemetryPayload::Change(ChangeEvent {
                change_id: "deploy-1".into(),
                change_type: ChangeType::Deployment,
                version_before: Some("v1".into()),
                version_after: Some("v2".into()),
                actor: None,
                metadata: IndexMap::new(),
            }),
            "ch1",
        ));
        envs.push(envelope(
            "backend",
            9 * sec,
            TelemetrySignal::Log,
            TelemetryPayload::Log(LogEvent {
                severity_number: Some(17),
                severity_text: Some("ERROR".into()),
                body: "oom".into(),
                template_id: None,
                trace_id: None,
                span_id: None,
            }),
            "lg1",
        ));
        envs.sort_by_key(|e| e.event_time_ns);
        envs
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    fn get<'a>(set: &'a FeatureSet, service: &str) -> &'a CandidateFeatures {
        set.candidates
            .iter()
            .find(|c| c.service == service)
            .unwrap()
    }

    #[test]
    fn backend_precedes_and_carries_change_and_log_evidence() {
        let set = compute_features(&scenario(), &FeatureConfig::default());
        let backend = get(&set, "backend");
        let frontend = get(&set, "frontend");

        assert!(backend.onset_ns.is_some());
        assert!(frontend.onset_ns.is_some());
        assert!(backend.onset_ns < frontend.onset_ns);
        assert!(backend.temporal_precedence > frontend.temporal_precedence);
        assert!(backend.change_proximity > 0.9);
        assert_eq!(backend.change_refs, vec!["ch1".to_owned()]);
        assert!(backend.log_evidence > 0.0);
        assert_eq!(backend.log_refs, vec!["lg1".to_owned()]);
        assert_eq!(frontend.change_proximity, 0.0);
        assert!(backend.anomaly_strength > 0.0);
    }

    #[test]
    fn impact_flows_to_transitive_callers() {
        let set = compute_features(&scenario(), &FeatureConfig::default());
        let backend = get(&set, "backend");
        let frontend = get(&set, "frontend");
        // Backend's fault impacts its caller frontend.
        assert_eq!(backend.impacted_anomalous, vec!["frontend".to_owned()]);
        assert!(backend.topology_consistency > 0.99);
        // Frontend has no callers, so it explains nothing.
        assert!(frontend.impacted_anomalous.is_empty());
        assert_eq!(frontend.topology_consistency, 0.0);
    }

    #[test]
    fn contradiction_hits_late_movers_not_first_cause() {
        let set = compute_features(&scenario(), &FeatureConfig::default());
        let backend = get(&set, "backend");
        // Frontend went anomalous after backend, so nothing impacted precedes
        // backend.
        assert_eq!(backend.contradiction_penalty, 0.0);
        assert!(backend.preceding_impacted.is_empty());
    }

    #[test]
    fn failed_trace_coverage_and_excess_share() {
        let set = compute_features(&scenario(), &FeatureConfig::default());
        let backend = get(&set, "backend");
        assert!((backend.failed_trace_coverage - 1.0).abs() < 1e-12);
        assert!(backend.critical_path_contribution > 0.0);
        assert!(backend.critical_path_contribution <= 1.0);
        assert_eq!(backend.failed_trace_ids.len(), 4);
    }

    #[test]
    fn all_features_bounded() {
        let set = compute_features(&scenario(), &FeatureConfig::default());
        for c in &set.candidates {
            for v in [
                c.anomaly_strength,
                c.temporal_precedence,
                c.failed_trace_coverage,
                c.critical_path_contribution,
                c.downstream_impact,
                c.topology_consistency,
                c.change_proximity,
                c.log_evidence,
                c.persistence,
                c.contradiction_penalty,
            ] {
                assert!((0.0..=1.0).contains(&v), "{}: {v}", c.service);
            }
        }
    }

    #[test]
    fn deterministic_output() {
        let a = serde_json::to_string(&compute_features(&scenario(), &FeatureConfig::default()))
            .unwrap();
        let b = serde_json::to_string(&compute_features(&scenario(), &FeatureConfig::default()))
            .unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn healthy_stream_yields_no_anomalies() {
        let sec = 1_000_000_000i64;
        let mut envs = Vec::new();
        for i in 0..20 {
            envs.push(metric(
                "backend",
                i * sec,
                100.0 + (i % 3) as f64,
                &format!("m{i}"),
            ));
        }
        let set = compute_features(&envs, &FeatureConfig::default());
        assert!(set.anomaly_intervals.is_empty());
        assert_eq!(set.incident_onset_ns, None);
        let backend = get(&set, "backend");
        assert_eq!(backend.anomaly_strength, 0.0);
        assert_eq!(backend.contradiction_penalty, 0.0);
    }
}
