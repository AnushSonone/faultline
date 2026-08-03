//! Single-trace detail: DAG + critical path + healthy comparison (TA-037).

use faultline_common::{SpanStatus, TelemetryEnvelope};
use faultline_graph::{
    compare_traces, critical_path, match_healthy_cohort, CohortMatch, CriticalPath,
    TraceComparison, TraceDag, TraceStore,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceDetail {
    pub dag: TraceDag,
    pub critical_path: Option<CriticalPath>,
    /// Present when the trace contains error spans and any healthy cohort
    /// candidates exist.
    pub cohort: Option<CohortMatch>,
    /// Failed-vs-median-healthy comparison when a reference was found.
    pub comparison: Option<TraceComparison>,
}

/// Build the detail view for one trace at the replay cursor.
pub fn build_trace_detail(
    envelopes: &[TelemetryEnvelope],
    trace_id: &str,
    cursor_event_time_ns: i64,
    incident_onset_ns: Option<i64>,
) -> Option<TraceDetail> {
    let store = TraceStore::from_envelopes_until(envelopes, cursor_event_time_ns);
    let dag = store.get(trace_id)?;
    let cp = critical_path(&dag);

    let failed = dag.spans.iter().any(|s| s.status == SpanStatus::Error);
    let (cohort, comparison) = if failed {
        let all = store.all_dags();
        let m = match_healthy_cohort(&all, &dag, incident_onset_ns);
        let comparison = m.median_trace_id.as_deref().and_then(|median_id| {
            store
                .get(median_id)
                .map(|healthy| compare_traces(&dag, &healthy, m.confidence))
        });
        (Some(m), comparison)
    } else {
        (None, None)
    };

    Some(TraceDetail {
        dag,
        critical_path: cp,
        cohort,
        comparison,
    })
}
