//! Deployment-correlation projection (temporal join product view). Not RCA.

use faultline_common::{TelemetryEnvelope, TelemetryPayload, TelemetrySignal};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DeploymentCorrelation {
    pub change_id: String,
    pub service: String,
    pub change_type: String,
    pub deployed_version: Option<String>,
    pub deployed_at_ns: i64,
    pub first_anomaly_ns: Option<i64>,
    pub delay_ns: Option<i64>,
    pub associated_anomalous_windows: u64,
    pub p99_before: Option<f64>,
    pub p99_after: Option<f64>,
    pub match_confidence: String,
    pub evidence_refs: Vec<String>,
    pub language: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CorrelationProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub correlations: Vec<DeploymentCorrelation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JoinEvidenceInput {
    pub telemetry_ref: String,
    pub service: String,
    pub change_id: String,
    pub change_type: String,
    pub deployed_version: Option<String>,
    pub change_time_ns: i64,
    pub unmatched: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PercentileWindowInput {
    pub service: String,
    pub percentile: String,
    pub estimated_value: f64,
    pub window_start_ns: i64,
    pub window_end_ns: i64,
}

/// Build correlation cards from join emits + percentile emits (streaming path).
pub fn build_correlation_from_emits(
    join_emits: &[JoinEvidenceInput],
    p99_windows: &[PercentileWindowInput],
    cursor_ns: i64,
    projection_version: u64,
) -> CorrelationProjection {
    let mut by_change: IndexMap<String, DeploymentCorrelation> = IndexMap::new();

    for j in join_emits
        .iter()
        .filter(|e| !e.unmatched && !e.change_id.is_empty())
    {
        if j.change_time_ns > cursor_ns {
            continue;
        }
        let entry = by_change
            .entry(j.change_id.clone())
            .or_insert_with(|| DeploymentCorrelation {
                change_id: j.change_id.clone(),
                service: j.service.clone(),
                change_type: j.change_type.clone(),
                deployed_version: j.deployed_version.clone(),
                deployed_at_ns: j.change_time_ns,
                first_anomaly_ns: None,
                delay_ns: None,
                associated_anomalous_windows: 0,
                p99_before: None,
                p99_after: None,
                match_confidence: "temporal_proximity".into(),
                evidence_refs: Vec::new(),
                language: "associated with nearby telemetry; not proven causation".into(),
            });
        entry.evidence_refs.push(j.telemetry_ref.clone());
        entry.associated_anomalous_windows = entry.associated_anomalous_windows.saturating_add(1);
    }

    for c in by_change.values_mut() {
        let mut before = Vec::new();
        let mut after = Vec::new();
        for p in p99_windows
            .iter()
            .filter(|p| p.service == c.service && p.percentile == "p99")
        {
            if p.window_end_ns <= c.deployed_at_ns {
                before.push(p.estimated_value);
            } else if p.window_start_ns >= c.deployed_at_ns {
                after.push(p.estimated_value);
                if c.first_anomaly_ns.is_none() {
                    let thresh = before.last().copied().unwrap_or(0.0) * 1.5;
                    if p.estimated_value >= thresh.max(1.0) {
                        c.first_anomaly_ns = Some(p.window_start_ns);
                    }
                }
            }
        }
        c.p99_before = before.last().copied();
        c.p99_after = after.first().copied();
        if let Some(fa) = c.first_anomaly_ns {
            c.delay_ns = Some(fa.saturating_sub(c.deployed_at_ns));
        }
        c.evidence_refs.sort();
        c.evidence_refs.dedup();
    }

    let mut correlations: Vec<_> = by_change.into_values().collect();
    correlations.sort_by(|a, b| {
        a.deployed_at_ns
            .cmp(&b.deployed_at_ns)
            .then(a.change_id.cmp(&b.change_id))
    });

    CorrelationProjection {
        projection_version,
        cursor_event_time_ns: cursor_ns,
        correlations,
    }
}

/// Fallback: scan envelopes for deployments and nearby latency (precomputed assist).
pub fn build_correlation_precomputed(
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
    projection_version: u64,
) -> CorrelationProjection {
    let mut deployments = Vec::new();
    for env in envelopes
        .iter()
        .filter(|e| e.event_time_ns <= cursor_ns)
        .filter(|e| {
            matches!(
                e.signal,
                TelemetrySignal::Deployment | TelemetrySignal::Configuration
            )
        })
    {
        let TelemetryPayload::Change(c) = &env.payload else {
            continue;
        };
        let Some(service) = env.service.clone() else {
            continue;
        };
        deployments.push((
            c.change_id.clone(),
            service,
            format!("{:?}", c.change_type).to_ascii_lowercase(),
            c.version_after.clone(),
            env.event_time_ns,
        ));
    }

    let mut correlations = Vec::new();
    for (change_id, service, change_type, version, deployed_at) in deployments {
        let mut lat_after = Vec::new();
        let mut lat_before = Vec::new();
        for env in envelopes.iter().filter(|e| e.event_time_ns <= cursor_ns) {
            if env.service.as_deref() != Some(service.as_str()) {
                continue;
            }
            let TelemetryPayload::Metric(m) = &env.payload else {
                continue;
            };
            if !m.name.contains("lat") {
                continue;
            }
            if env.event_time_ns < deployed_at {
                lat_before.push((env.event_time_ns, m.value));
            } else {
                lat_after.push((env.event_time_ns, m.value));
            }
        }
        lat_before.sort_by_key(|(t, _)| *t);
        lat_after.sort_by_key(|(t, _)| *t);
        let before_vals: Vec<_> = lat_before.iter().map(|(_, v)| *v).collect();
        let after_vals: Vec<_> = lat_after.iter().map(|(_, v)| *v).collect();
        let p99_before = percentile_approx(&before_vals, 0.99);
        let p99_after = percentile_approx(&after_vals, 0.99);
        let first_anomaly = lat_after
            .iter()
            .find(|(_, v)| *v > p99_before.unwrap_or(0.0).max(1.0) * 1.5)
            .map(|(t, _)| *t);
        correlations.push(DeploymentCorrelation {
            change_id,
            service,
            change_type,
            deployed_version: version,
            deployed_at_ns: deployed_at,
            first_anomaly_ns: first_anomaly,
            delay_ns: first_anomaly.map(|t| t.saturating_sub(deployed_at)),
            associated_anomalous_windows: lat_after.len() as u64,
            p99_before,
            p99_after,
            match_confidence: "temporal_proximity".into(),
            evidence_refs: Vec::new(),
            language: "occurred shortly before elevated latency; supports investigation".into(),
        });
    }
    correlations.sort_by_key(|a| a.deployed_at_ns);
    CorrelationProjection {
        projection_version,
        cursor_event_time_ns: cursor_ns,
        correlations,
    }
}

use faultline_common::exact_percentile as percentile_approx;
