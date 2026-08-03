//! Physical plan + executor (TA-046). Maps logical nodes onto the engine's
//! operators: percentile aggregates run through the SAME
//! `PercentileOperator` (DDSketch) the streaming heatmap uses, and the
//! temporal join through `TemporalIntervalJoin` - one implementation for
//! product and queries.

use std::collections::BTreeMap;

use faultline_common::{TelemetryEnvelope, TelemetryPayload, TelemetrySignal};
use faultline_engine::{BoundedPercentileSketch, TemporalIntervalJoin, DEFAULT_SKETCH_ALPHA};
use serde::{Deserialize, Serialize};

use crate::ast::{AggregateFn, BinaryOp, Expr, Literal, WindowSpec};
use crate::logical::LogicalPlan;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhysicalOperator {
    pub operator_id: String,
    pub kind: String,
    pub detail: String,
}

/// Executable operator DAG description. Execution itself is interpreted over
/// the plan tree; this DTO is what EXPLAIN shows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhysicalPlan {
    pub operators: Vec<PhysicalOperator>,
    pub partitioning: String,
    pub state_retention: String,
    pub watermark_policy: String,
}

pub fn build_physical_plan(logical: &LogicalPlan) -> PhysicalPlan {
    let mut operators = Vec::new();
    walk(logical, &mut operators);
    operators.reverse(); // source first
    PhysicalPlan {
        operators,
        partitioning: "single partition (session replay)".into(),
        state_retention: "windows retained until watermark + 1s grace".into(),
        watermark_policy: "bounded out-of-orderness, 2s allowed lateness".into(),
    }
}

fn walk(plan: &LogicalPlan, out: &mut Vec<PhysicalOperator>) {
    match plan {
        LogicalPlan::Scan { table, columns } => out.push(PhysicalOperator {
            operator_id: format!("scan_{table}"),
            kind: "source".into(),
            detail: format!("replay envelopes -> {table} rows [{}]", columns.join(", ")),
        }),
        LogicalPlan::Filter { input, predicate } => {
            out.push(PhysicalOperator {
                operator_id: "filter".into(),
                kind: "filter".into(),
                detail: format!("{predicate:?}"),
            });
            walk(input, out);
        }
        LogicalPlan::Project { input, exprs } => {
            out.push(PhysicalOperator {
                operator_id: "project".into(),
                kind: "project".into(),
                detail: exprs
                    .iter()
                    .map(|e| e.output_name.clone())
                    .collect::<Vec<_>>()
                    .join(", "),
            });
            walk(input, out);
        }
        LogicalPlan::Aggregate {
            input, aggregates, ..
        } => {
            let uses_sketch = aggregates.iter().any(|a| {
                matches!(
                    a.func,
                    AggregateFn::P50 | AggregateFn::P95 | AggregateFn::P99
                )
            });
            out.push(PhysicalOperator {
                operator_id: if uses_sketch {
                    "latency_percentile".into()
                } else {
                    "hash_aggregate".into()
                },
                kind: "aggregate".into(),
                detail: if uses_sketch {
                    "DDSketch percentile operator (shared with streaming heatmap)".into()
                } else {
                    "hash aggregate".into()
                },
            });
            walk(input, out);
        }
        LogicalPlan::Window { input, spec } => {
            out.push(PhysicalOperator {
                operator_id: "window_assign".into(),
                kind: "window".into(),
                detail: format!("{spec:?}"),
            });
            walk(input, out);
        }
        LogicalPlan::TemporalJoin { input, spec } => {
            out.push(PhysicalOperator {
                operator_id: "deploy_temporal_join".into(),
                kind: "temporal_join".into(),
                detail: format!(
                    "left interval join vs {} (shared operator)",
                    spec.right_table
                ),
            });
            walk(input, out);
        }
        LogicalPlan::Sort { input, order_by } => {
            out.push(PhysicalOperator {
                operator_id: "sort".into(),
                kind: "sort".into(),
                detail: format!("{order_by:?}"),
            });
            walk(input, out);
        }
        LogicalPlan::Limit {
            input,
            limit,
            top_k,
        } => {
            out.push(PhysicalOperator {
                operator_id: if *top_k {
                    "top_k".into()
                } else {
                    "limit".into()
                },
                kind: "limit".into(),
                detail: format!("{limit}"),
            });
            walk(input, out);
        }
        LogicalPlan::Sink { input } => {
            out.push(PhysicalOperator {
                operator_id: "result_sink".into(),
                kind: "sink".into(),
                detail: "row collection".into(),
            });
            walk(input, out);
        }
    }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

pub type Row = BTreeMap<String, Value>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Text(String),
    Int(i64),
    Float(f64),
    Null,
}

impl Value {
    fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Int(i) => Some(*i as f64),
            Value::Float(f) => Some(*f),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Row>,
    /// EXPLAIN ANALYZE-style runtime metrics per stage.
    pub metrics: ExecMetrics,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ExecMetrics {
    pub rows_scanned: u64,
    pub rows_after_filter: u64,
    pub rows_out: u64,
    pub wall_time_us: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum ExecError {
    #[error("execution: {0}")]
    Message(String),
}

/// Execute the plan over envelopes at or before `cursor_ns`.
pub fn execute(
    logical: &LogicalPlan,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
) -> Result<QueryResult, ExecError> {
    let started = std::time::Instant::now();
    let mut metrics = ExecMetrics::default();
    let rows = run(logical, envelopes, cursor_ns, &mut metrics)?;
    let columns = rows
        .first()
        .map(|r| r.keys().cloned().collect())
        .unwrap_or_default();
    metrics.rows_out = rows.len() as u64;
    metrics.wall_time_us = started.elapsed().as_micros() as u64;
    Ok(QueryResult {
        columns,
        rows,
        metrics,
    })
}

fn run(
    plan: &LogicalPlan,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
    metrics: &mut ExecMetrics,
) -> Result<Vec<Row>, ExecError> {
    match plan {
        LogicalPlan::Scan { table, .. } => {
            let rows = scan(table, envelopes, cursor_ns)?;
            metrics.rows_scanned = rows.len() as u64;
            Ok(rows)
        }
        LogicalPlan::Filter { input, predicate } => {
            let rows = run(input, envelopes, cursor_ns, metrics)?;
            let out: Vec<Row> = rows
                .into_iter()
                .filter(|r| truthy(&eval(predicate, r)))
                .collect();
            metrics.rows_after_filter = out.len() as u64;
            Ok(out)
        }
        LogicalPlan::Project { input, exprs } => {
            let rows = run(input, envelopes, cursor_ns, metrics)?;
            Ok(rows
                .into_iter()
                .map(|r| {
                    exprs
                        .iter()
                        .map(|p| (p.output_name.clone(), eval(&p.expr, &r)))
                        .collect()
                })
                .collect())
        }
        LogicalPlan::Window { input, .. } => {
            // Window assignment happens inside Aggregate (needs the spec);
            // pass rows through carrying event_time.
            run(input, envelopes, cursor_ns, metrics)
        }
        LogicalPlan::Aggregate {
            input,
            group_by,
            aggregates,
        } => {
            let window = find_window(input);
            let rows = run(input, envelopes, cursor_ns, metrics)?;
            aggregate(rows, group_by, aggregates, window)
        }
        LogicalPlan::TemporalJoin { input, spec } => {
            let rows = run(input, envelopes, cursor_ns, metrics)?;
            temporal_join(rows, envelopes, cursor_ns, spec)
        }
        LogicalPlan::Sort { input, order_by } => {
            let mut rows = run(input, envelopes, cursor_ns, metrics)?;
            rows.sort_by(|a, b| {
                for o in order_by {
                    let av = a.get(&o.column).cloned().unwrap_or(Value::Null);
                    let bv = b.get(&o.column).cloned().unwrap_or(Value::Null);
                    let ord = compare(&av, &bv);
                    let ord = if o.descending { ord.reverse() } else { ord };
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                std::cmp::Ordering::Equal
            });
            Ok(rows)
        }
        LogicalPlan::Limit { input, limit, .. } => {
            let mut rows = run(input, envelopes, cursor_ns, metrics)?;
            rows.truncate(*limit);
            Ok(rows)
        }
        LogicalPlan::Sink { input } => run(input, envelopes, cursor_ns, metrics),
    }
}

fn find_window(plan: &LogicalPlan) -> Option<WindowSpec> {
    match plan {
        LogicalPlan::Window { spec, .. } => Some(spec.clone()),
        LogicalPlan::Scan { .. } => None,
        LogicalPlan::Filter { input, .. }
        | LogicalPlan::Project { input, .. }
        | LogicalPlan::Aggregate { input, .. }
        | LogicalPlan::TemporalJoin { input, .. }
        | LogicalPlan::Sort { input, .. }
        | LogicalPlan::Limit { input, .. }
        | LogicalPlan::Sink { input } => find_window(input),
    }
}

fn scan(
    table: &str,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
) -> Result<Vec<Row>, ExecError> {
    let visible = envelopes.iter().filter(|e| e.event_time_ns <= cursor_ns);
    let mut rows = Vec::new();
    match table {
        "metrics" => {
            for env in visible {
                if let (Some(service), TelemetryPayload::Metric(m)) =
                    (env.service.as_deref(), &env.payload)
                {
                    rows.push(Row::from([
                        ("service".into(), Value::Text(service.to_owned())),
                        ("name".into(), Value::Text(m.name.clone())),
                        ("value".into(), Value::Float(m.value)),
                        ("event_time".into(), Value::Int(env.event_time_ns)),
                    ]));
                }
            }
        }
        "spans" => {
            for env in visible {
                if let (Some(service), TelemetryPayload::Span(s)) =
                    (env.service.as_deref(), &env.payload)
                {
                    rows.push(Row::from([
                        ("service".into(), Value::Text(service.to_owned())),
                        ("operation".into(), Value::Text(s.operation.clone())),
                        ("duration_ns".into(), Value::Int(s.duration_ns)),
                        (
                            "status".into(),
                            Value::Text(format!("{:?}", s.status).to_ascii_lowercase()),
                        ),
                        ("trace_id".into(), Value::Text(s.trace_id.clone())),
                        ("event_time".into(), Value::Int(env.event_time_ns)),
                    ]));
                }
            }
        }
        "logs" => {
            for env in visible {
                if let (Some(service), TelemetryPayload::Log(l)) =
                    (env.service.as_deref(), &env.payload)
                {
                    rows.push(Row::from([
                        ("service".into(), Value::Text(service.to_owned())),
                        (
                            "severity".into(),
                            Value::Text(l.severity_text.clone().unwrap_or_default()),
                        ),
                        ("body".into(), Value::Text(l.body.clone())),
                        ("event_time".into(), Value::Int(env.event_time_ns)),
                    ]));
                }
            }
        }
        "deployments" => {
            for env in visible {
                if let (Some(service), TelemetryPayload::Change(c)) =
                    (env.service.as_deref(), &env.payload)
                {
                    rows.push(Row::from([
                        ("service".into(), Value::Text(service.to_owned())),
                        ("change_id".into(), Value::Text(c.change_id.clone())),
                        (
                            "change_type".into(),
                            Value::Text(format!("{:?}", c.change_type).to_ascii_lowercase()),
                        ),
                        (
                            "version_after".into(),
                            Value::Text(c.version_after.clone().unwrap_or_default()),
                        ),
                        ("event_time".into(), Value::Int(env.event_time_ns)),
                    ]));
                }
            }
        }
        "incidents" => {
            for env in visible {
                if env.signal == TelemetrySignal::Control {
                    // No incident storage in V1; empty result set with schema.
                }
            }
        }
        other => return Err(ExecError::Message(format!("unknown table {other}"))),
    }
    Ok(rows)
}

fn aggregate(
    rows: Vec<Row>,
    group_by: &[String],
    aggregates: &[crate::logical::AggregateExpr],
    window: Option<WindowSpec>,
) -> Result<Vec<Row>, ExecError> {
    // Group key: group columns + optional window bucket.
    let mut groups: BTreeMap<Vec<String>, Vec<Row>> = BTreeMap::new();
    for row in rows {
        let mut key: Vec<String> = group_by
            .iter()
            .map(|g| render(&row.get(g).cloned().unwrap_or(Value::Null)))
            .collect();
        if let Some(w) = &window {
            let t = row
                .get("event_time")
                .and_then(|v| match v {
                    Value::Int(i) => Some(*i),
                    _ => None,
                })
                .ok_or_else(|| ExecError::Message("window requires event_time".into()))?;
            let size = match w {
                WindowSpec::Tumble { size_ns } => *size_ns,
                WindowSpec::Hop { slide_ns, .. } => *slide_ns,
            }
            .max(1);
            key.push(((t.div_euclid(size)) * size).to_string());
        }
        groups.entry(key).or_default().push(row);
    }

    let uses_sketch = aggregates.iter().any(|a| {
        matches!(
            a.func,
            AggregateFn::P50 | AggregateFn::P95 | AggregateFn::P99
        )
    });

    let mut out = Vec::new();
    for (key, members) in groups {
        let mut row = Row::new();
        for (i, g) in group_by.iter().enumerate() {
            row.insert(g.clone(), Value::Text(key[i].clone()));
        }
        if window.is_some() {
            if let Some(bucket) = key.last() {
                row.insert(
                    "window_start".into(),
                    Value::Int(bucket.parse().unwrap_or(0)),
                );
            }
        }
        // Percentiles go through the engine's DDSketch (same sketch type and
        // alpha as the streaming heatmap operator) so SQL results match the
        // product path.
        let mut sketch: Option<BoundedPercentileSketch> = None;
        if uses_sketch {
            let mut s = BoundedPercentileSketch::new(DEFAULT_SKETCH_ALPHA);
            let arg = aggregates
                .iter()
                .find(|a| {
                    matches!(
                        a.func,
                        AggregateFn::P50 | AggregateFn::P95 | AggregateFn::P99
                    )
                })
                .and_then(|a| a.arg.clone());
            for m in &members {
                if let Some(v) = arg
                    .as_ref()
                    .and_then(|arg| m.get(arg))
                    .and_then(Value::as_f64)
                {
                    s.add(v);
                }
            }
            sketch = Some(s);
        }
        for agg in aggregates {
            let values: Vec<f64> = members
                .iter()
                .filter_map(|m| {
                    agg.arg
                        .as_ref()
                        .and_then(|arg| m.get(arg))
                        .and_then(Value::as_f64)
                })
                .collect();
            let value = match agg.func {
                AggregateFn::Count => Value::Int(members.len() as i64),
                AggregateFn::Sum => Value::Float(values.iter().sum()),
                AggregateFn::Avg => {
                    if values.is_empty() {
                        Value::Null
                    } else {
                        Value::Float(values.iter().sum::<f64>() / values.len() as f64)
                    }
                }
                AggregateFn::Min => values
                    .iter()
                    .copied()
                    .fold(None::<f64>, |m, v| Some(m.map_or(v, |m| m.min(v))))
                    .map(Value::Float)
                    .unwrap_or(Value::Null),
                AggregateFn::Max => values
                    .iter()
                    .copied()
                    .fold(None::<f64>, |m, v| Some(m.map_or(v, |m| m.max(v))))
                    .map(Value::Float)
                    .unwrap_or(Value::Null),
                AggregateFn::P50 | AggregateFn::P95 | AggregateFn::P99 => {
                    let q = match agg.func {
                        AggregateFn::P50 => 0.50,
                        AggregateFn::P95 => 0.95,
                        _ => 0.99,
                    };
                    sketch
                        .as_ref()
                        .and_then(|s| s.quantile(q))
                        .map(Value::Float)
                        .unwrap_or(Value::Null)
                }
            };
            row.insert(agg.output_name.clone(), value);
        }
        out.push(row);
    }
    Ok(out)
}

/// V1 temporal join through the engine's TemporalIntervalJoin operator.
fn temporal_join(
    rows: Vec<Row>,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
    spec: &crate::ast::TemporalJoinSpec,
) -> Result<Vec<Row>, ExecError> {
    let mut join = TemporalIntervalJoin::new(
        "sql_temporal_join",
        "sql",
        spec.lookback_ns,
        spec.lookahead_ns,
        1_000_000_000,
    );
    // Right side: deployments from the envelope stream.
    for env in envelopes.iter().filter(|e| e.event_time_ns <= cursor_ns) {
        if let (Some(service), TelemetryPayload::Change(c)) = (env.service.as_deref(), &env.payload)
        {
            let _ = join.push_deployment(
                env.event_id.as_str(),
                &c.change_id,
                format!("{:?}", c.change_type).to_ascii_lowercase(),
                service,
                env.event_time_ns,
                c.version_after.clone(),
                0,
            );
        }
    }
    // Left side: input rows.
    let mut out = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let service = row.get("service").map(render_ref).unwrap_or_default();
        let t = row
            .get("event_time")
            .and_then(|v| match v {
                Value::Int(i) => Some(*i),
                _ => None,
            })
            .unwrap_or(0);
        let emits = join.push_telemetry(format!("row-{i}"), &service, t, t, t, 0);
        let mut matched = false;
        for e in emits.iter().filter(|e| !e.unmatched) {
            let mut joined = row.clone();
            joined.insert("change_id".into(), Value::Text(e.change_id.clone()));
            joined.insert("change_type".into(), Value::Text(e.change_type.clone()));
            joined.insert(
                "version_after".into(),
                Value::Text(e.deployed_version.clone().unwrap_or_default()),
            );
            joined.insert("delay_ns".into(), Value::Int(t - e.change_time_ns));
            out.push(joined);
            matched = true;
        }
        if !matched {
            // LEFT join: keep unmatched telemetry with nulls.
            let mut joined = row.clone();
            joined.insert("change_id".into(), Value::Null);
            joined.insert("change_type".into(), Value::Null);
            joined.insert("version_after".into(), Value::Null);
            joined.insert("delay_ns".into(), Value::Null);
            out.push(joined);
        }
    }
    Ok(out)
}

fn eval(e: &Expr, row: &Row) -> Value {
    match e {
        Expr::Column(c) => row.get(c).cloned().unwrap_or(Value::Null),
        Expr::Literal(l) => match l {
            Literal::Text(s) => Value::Text(s.clone()),
            Literal::Int(i) => Value::Int(*i),
            Literal::Float(f) => Value::Float(*f),
        },
        Expr::Binary { left, op, right } => {
            let l = eval(left, row);
            let r = eval(right, row);
            match op {
                BinaryOp::And => Value::Int((truthy(&l) && truthy(&r)) as i64),
                BinaryOp::Or => Value::Int((truthy(&l) || truthy(&r)) as i64),
                BinaryOp::Like => {
                    let (Value::Text(s), Value::Text(pat)) = (&l, &r) else {
                        return Value::Int(0);
                    };
                    Value::Int(like_match(s, pat) as i64)
                }
                BinaryOp::Eq => Value::Int((compare(&l, &r) == std::cmp::Ordering::Equal) as i64),
                BinaryOp::NotEq => {
                    Value::Int((compare(&l, &r) != std::cmp::Ordering::Equal) as i64)
                }
                BinaryOp::Lt => Value::Int((compare(&l, &r) == std::cmp::Ordering::Less) as i64),
                BinaryOp::LtEq => {
                    Value::Int((compare(&l, &r) != std::cmp::Ordering::Greater) as i64)
                }
                BinaryOp::Gt => Value::Int((compare(&l, &r) == std::cmp::Ordering::Greater) as i64),
                BinaryOp::GtEq => Value::Int((compare(&l, &r) != std::cmp::Ordering::Less) as i64),
                BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div => {
                    match (l.as_f64(), r.as_f64()) {
                        (Some(x), Some(y)) => Value::Float(match op {
                            BinaryOp::Add => x + y,
                            BinaryOp::Sub => x - y,
                            BinaryOp::Mul => x * y,
                            _ => x / y,
                        }),
                        _ => Value::Null,
                    }
                }
            }
        }
        Expr::Not(inner) => Value::Int(!truthy(&eval(inner, row)) as i64),
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Int(i) => *i != 0,
        Value::Float(f) => *f != 0.0,
        Value::Text(s) => !s.is_empty(),
        Value::Null => false,
    }
}

fn compare(a: &Value, b: &Value) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (a, b) {
        (Value::Text(x), Value::Text(y)) => x.cmp(y),
        _ => match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
            (None, None) => Ordering::Equal,
            (None, _) => Ordering::Less,
            (_, None) => Ordering::Greater,
        },
    }
}

/// SQL LIKE with % wildcards only.
fn like_match(s: &str, pattern: &str) -> bool {
    let parts: Vec<&str> = pattern.split('%').collect();
    let mut pos = 0usize;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !s.starts_with(part) {
                return false;
            }
            pos = part.len();
        } else if i == parts.len() - 1 && !pattern.ends_with('%') {
            return s[pos..].ends_with(part);
        } else if let Some(found) = s[pos..].find(part) {
            pos += found + part.len();
        } else {
            return false;
        }
    }
    true
}

fn render(v: &Value) -> String {
    match v {
        Value::Text(s) => s.clone(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => f.to_string(),
        Value::Null => "null".into(),
    }
}

fn render_ref(v: &Value) -> String {
    render(v)
}
