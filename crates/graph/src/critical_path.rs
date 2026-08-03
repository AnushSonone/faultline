//! Trace critical path (TA-035, spec 17.3).
//!
//! The critical path is the longest causally valid path through the trace
//! DAG based on span timing and dependencies - never a sum of all span
//! durations. Computed by walking each root backwards in time: at cursor `t`,
//! the child that finishes last at or before `t` (and starts within the
//! parent) is on the critical path; time not covered by any child is the
//! parent's own execution time.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::trace_graph::{TraceDag, TraceSpanNode};

/// One contiguous stretch of the critical path attributed to a single span.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CriticalSegment {
    pub span_id: String,
    pub service: Option<String>,
    pub operation: String,
    pub start_ns: i64,
    pub end_ns: i64,
    /// True when the segment is the span's own execution time; false when the
    /// parent was blocked waiting on the child that owns this segment.
    pub self_time: bool,
}

/// Critical path of one trace.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CriticalPath {
    pub trace_id: String,
    /// Root span envelope duration (earliest start to latest end of the
    /// chosen root's subtree).
    pub total_duration_ns: i64,
    /// Sum of critical segment durations. Never exceeds `total_duration_ns`.
    pub critical_duration_ns: i64,
    /// Span ids on the critical path, root first.
    pub span_ids: Vec<String>,
    pub segments: Vec<CriticalSegment>,
    /// Critical time attributed to each service, deterministic order.
    pub service_contribution_ns: BTreeMap<String, i64>,
    /// True when the trace had missing parents; path is best-effort.
    pub incomplete: bool,
}

/// Compute the critical path of a trace DAG. Returns `None` for empty traces.
pub fn critical_path(dag: &TraceDag) -> Option<CriticalPath> {
    if dag.spans.is_empty() {
        return None;
    }

    // Child index: parent span id -> child indices, deterministic order.
    let mut children: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (idx, span) in dag.spans.iter().enumerate() {
        if let Some(parent) = span.parent_span_id.as_deref() {
            if !span.missing_parent {
                children.entry(parent).or_default().push(idx);
            }
        }
    }

    // Roots: spans without a resolvable parent. Pick the one with the widest
    // envelope (ties: earliest start, then span id) as the trace root.
    let root_idx = dag
        .spans
        .iter()
        .enumerate()
        .filter(|(_, s)| s.parent_span_id.is_none() || s.missing_parent)
        .max_by(|(_, a), (_, b)| {
            (a.end_time_ns - a.start_time_ns)
                .cmp(&(b.end_time_ns - b.start_time_ns))
                .then_with(|| b.start_time_ns.cmp(&a.start_time_ns))
                .then_with(|| b.span_id.cmp(&a.span_id))
        })
        .map(|(i, _)| i)?;

    let mut segments: Vec<CriticalSegment> = Vec::new();
    let mut span_ids: Vec<String> = Vec::new();
    let root_end = dag.spans[root_idx].end_time_ns;
    walk(
        &dag.spans,
        &children,
        root_idx,
        root_end,
        &mut segments,
        &mut span_ids,
    );

    // Segments were produced walking backwards; order them forward in time.
    segments.sort_by(|a, b| {
        a.start_ns
            .cmp(&b.start_ns)
            .then_with(|| a.span_id.cmp(&b.span_id))
    });

    let critical_duration_ns: i64 = segments
        .iter()
        .map(|s| (s.end_ns - s.start_ns).max(0))
        .sum();
    let mut service_contribution_ns: BTreeMap<String, i64> = BTreeMap::new();
    for seg in &segments {
        let svc = seg.service.clone().unwrap_or_else(|| "unknown".into());
        *service_contribution_ns.entry(svc).or_default() += (seg.end_ns - seg.start_ns).max(0);
    }

    let root = &dag.spans[root_idx];
    Some(CriticalPath {
        trace_id: dag.trace_id.clone(),
        total_duration_ns: (root.end_time_ns - root.start_time_ns).max(0),
        critical_duration_ns,
        span_ids,
        segments,
        service_contribution_ns,
        incomplete: dag.incomplete,
    })
}

/// Backward walk over one span: carve its interval into child-critical
/// segments and own execution segments. `hi_clip` bounds every segment so a
/// child overhanging its parent (async completion after the parent returned)
/// is never credited beyond the parent's envelope.
fn walk(
    spans: &[TraceSpanNode],
    children: &BTreeMap<&str, Vec<usize>>,
    idx: usize,
    hi_clip: i64,
    segments: &mut Vec<CriticalSegment>,
    span_ids: &mut Vec<String>,
) {
    let span = &spans[idx];
    span_ids.push(span.span_id.clone());
    let eff_end = span.end_time_ns.min(hi_clip);
    if eff_end <= span.start_time_ns {
        return;
    }

    // Causally valid children: start within the parent's effective interval.
    let mut kids: Vec<usize> = children
        .get(span.span_id.as_str())
        .map(|v| {
            v.iter()
                .copied()
                .filter(|&c| {
                    spans[c].start_time_ns >= span.start_time_ns && spans[c].start_time_ns < eff_end
                })
                .collect()
        })
        .unwrap_or_default();
    // Latest-finishing first.
    kids.sort_by(|&a, &b| {
        spans[b]
            .end_time_ns
            .cmp(&spans[a].end_time_ns)
            .then_with(|| spans[a].span_id.cmp(&spans[b].span_id))
    });

    let mut cursor = eff_end;
    for &child_idx in &kids {
        let child = &spans[child_idx];
        // Clip the child's credited interval to what is still uncovered.
        let child_end = child.end_time_ns.min(cursor);
        if child.start_time_ns >= cursor {
            continue;
        }
        // Parent self time between this child's end and the cursor.
        if child_end < cursor {
            segments.push(CriticalSegment {
                span_id: span.span_id.clone(),
                service: span.service.clone(),
                operation: span.operation.clone(),
                start_ns: child_end,
                end_ns: cursor,
                self_time: true,
            });
        }
        walk(spans, children, child_idx, child_end, segments, span_ids);
        cursor = child.start_time_ns;
        if cursor <= span.start_time_ns {
            break;
        }
    }
    if cursor > span.start_time_ns {
        segments.push(CriticalSegment {
            span_id: span.span_id.clone(),
            service: span.service.clone(),
            operation: span.operation.clone(),
            start_ns: span.start_time_ns,
            end_ns: cursor,
            self_time: true,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace_graph::TraceStore;
    use faultline_common::{
        EventId, SpanEvent, SpanKind, SpanStatus, TelemetryEnvelope, TelemetryPayload,
        TelemetrySignal, SCHEMA_VERSION,
    };
    use indexmap::IndexMap;

    fn span_env(
        service: &str,
        trace: &str,
        span_id: &str,
        parent: Option<&str>,
        start: i64,
        end: i64,
    ) -> TelemetryEnvelope {
        TelemetryEnvelope {
            schema_version: SCHEMA_VERSION,
            event_id: EventId::new(format!("e-{span_id}")),
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
                operation: format!("op-{service}"),
                start_time_ns: start,
                end_time_ns: end,
                duration_ns: end - start,
                status: SpanStatus::Ok,
                peer_service: None,
                span_kind: SpanKind::Server,
            }),
        }
    }

    fn dag(envs: &[TelemetryEnvelope]) -> TraceDag {
        let mut store = TraceStore::new();
        for e in envs {
            store.ingest_envelope(e);
        }
        store.all_dags().into_iter().next().unwrap()
    }

    /// root [0,100]; sequential children a [10,40], b [50,90].
    /// Critical: root self [0,10] + a [10,40] + root self [40,50] + b [50,90]
    /// + root self [90,100] = full envelope.
    #[test]
    fn sequential_children_cover_envelope() {
        let d = dag(&[
            span_env("root", "t", "r", None, 0, 100),
            span_env("a", "t", "a", Some("r"), 10, 40),
            span_env("b", "t", "b", Some("r"), 50, 90),
        ]);
        let cp = critical_path(&d).unwrap();
        assert_eq!(cp.total_duration_ns, 100);
        assert_eq!(cp.critical_duration_ns, 100);
        assert_eq!(cp.span_ids, vec!["r", "b", "a"]); // discovery order: backwards
        assert_eq!(cp.service_contribution_ns["root"], 30);
        assert_eq!(cp.service_contribution_ns["a"], 30);
        assert_eq!(cp.service_contribution_ns["b"], 40);
    }

    /// Parallel children [10,90] and [10,60]: only the longer one is critical.
    /// Never sum both.
    #[test]
    fn parallel_branches_take_longest_only() {
        let d = dag(&[
            span_env("root", "t", "r", None, 0, 100),
            span_env("slow", "t", "s", Some("r"), 10, 90),
            span_env("fast", "t", "f", Some("r"), 10, 60),
        ]);
        let cp = critical_path(&d).unwrap();
        assert_eq!(cp.critical_duration_ns, 100);
        assert!(cp.span_ids.contains(&"s".to_owned()));
        assert!(!cp.span_ids.contains(&"f".to_owned()));
        assert_eq!(cp.service_contribution_ns["slow"], 80);
        assert!(!cp.service_contribution_ns.contains_key("fast"));
    }

    /// Nested chain: root -> mid -> leaf. Leaf's time attributed to leaf, not
    /// double-counted through mid.
    #[test]
    fn nested_chain_attributes_leaf_time() {
        let d = dag(&[
            span_env("root", "t", "r", None, 0, 100),
            span_env("mid", "t", "m", Some("r"), 10, 90),
            span_env("leaf", "t", "l", Some("m"), 20, 80),
        ]);
        let cp = critical_path(&d).unwrap();
        assert_eq!(cp.critical_duration_ns, 100);
        assert_eq!(cp.service_contribution_ns["leaf"], 60);
        assert_eq!(cp.service_contribution_ns["mid"], 20);
        assert_eq!(cp.service_contribution_ns["root"], 20);
    }

    #[test]
    fn critical_never_exceeds_envelope_property() {
        // Pseudo-random traces; deterministic seed.
        let mut state: u64 = 0x9e3779b97f4a7c15;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for case in 0..200 {
            let mut envs = vec![span_env("root", "t", "r", None, 0, 1000)];
            let n = (next() % 8) as usize + 1;
            for i in 0..n {
                let parent = if i == 0 || next() % 2 == 0 {
                    "r".to_owned()
                } else {
                    format!("s{}", next() as usize % i)
                };
                let start = (next() % 900) as i64;
                let end = start + 1 + (next() % 300) as i64;
                envs.push(span_env(
                    &format!("svc{}", i % 3),
                    "t",
                    &format!("s{i}"),
                    Some(&parent),
                    start,
                    end.min(1000),
                ));
            }
            let cp = critical_path(&dag(&envs)).unwrap();
            assert!(
                cp.critical_duration_ns <= cp.total_duration_ns,
                "case {case}: critical {} > envelope {}",
                cp.critical_duration_ns,
                cp.total_duration_ns
            );
        }
    }

    #[test]
    fn missing_parent_marks_incomplete_but_computes() {
        let d = dag(&[
            span_env("root", "t", "r", None, 0, 100),
            span_env("orphan", "t", "o", Some("ghost"), 10, 40),
        ]);
        let cp = critical_path(&d).unwrap();
        assert!(cp.incomplete);
        assert!(cp.critical_duration_ns <= cp.total_duration_ns);
    }

    #[test]
    fn deterministic() {
        let envs = vec![
            span_env("root", "t", "r", None, 0, 100),
            span_env("a", "t", "a", Some("r"), 10, 60),
            span_env("b", "t", "b", Some("r"), 30, 90),
        ];
        let a = serde_json::to_string(&critical_path(&dag(&envs)).unwrap()).unwrap();
        let b = serde_json::to_string(&critical_path(&dag(&envs)).unwrap()).unwrap();
        assert_eq!(a, b);
    }
}
