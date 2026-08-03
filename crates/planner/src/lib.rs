//! Faultline query planner (TA-043..047): SQL subset -> owned AST ->
//! logical plan -> optimizer -> physical plan -> execution -> EXPLAIN.
//! sqlparser-rs is syntax only; plans, operators, and execution are owned
//! here (ADR 0006).

pub mod ast;
pub mod catalog;
pub mod explain;
pub mod logical;
pub mod optimizer;
pub mod parser;
pub mod physical;

pub use ast::Query;
pub use explain::{explain, ExplainOutput};
pub use logical::{build_logical_plan, LogicalPlan};
pub use optimizer::optimize;
pub use parser::{parse, ParseError};
pub use physical::{build_physical_plan, execute, PhysicalPlan, QueryResult};

use faultline_common::TelemetryEnvelope;

/// Parse, plan, optimize, and execute one query at the replay cursor.
pub fn run_query(
    sql: &str,
    envelopes: &[TelemetryEnvelope],
    cursor_ns: i64,
) -> Result<(QueryResult, ExplainOutput), String> {
    let query = parse(sql).map_err(|e| e.to_string())?;
    let logical = build_logical_plan(&query);
    let optimized = optimize(logical.clone());
    let physical = build_physical_plan(&optimized);
    let result = execute(&optimized, envelopes, cursor_ns).map_err(|e| e.to_string())?;
    let out = explain(
        sql,
        &logical,
        &optimized,
        &physical,
        Some(result.metrics.clone()),
    );
    Ok((result, out))
}

/// Validate a query without executing it.
pub fn validate_query(sql: &str) -> Result<ExplainOutput, String> {
    let query = parse(sql).map_err(|e| e.to_string())?;
    let logical = build_logical_plan(&query);
    let optimized = optimize(logical.clone());
    let physical = build_physical_plan(&optimized);
    Ok(explain(sql, &logical, &optimized, &physical, None))
}
