//! Faultline-owned query AST (TA-043). sqlparser is syntax-only; everything
//! after parse is this crate's own representation (ADR 0006: no DataFusion).

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Literal {
    Text(String),
    Int(i64),
    Float(f64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BinaryOp {
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    And,
    Or,
    Add,
    Sub,
    Mul,
    Div,
    Like,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Expr {
    Column(String),
    Literal(Literal),
    Binary {
        left: Box<Expr>,
        op: BinaryOp,
        right: Box<Expr>,
    },
    Not(Box<Expr>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregateFn {
    Count,
    Sum,
    Avg,
    Min,
    Max,
    P50,
    P95,
    P99,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum SelectItem {
    /// Plain column or expression.
    Expr { expr: Expr, alias: Option<String> },
    /// Aggregate over a column.
    Aggregate {
        func: AggregateFn,
        arg: Option<String>,
        alias: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum WindowSpec {
    Tumble { size_ns: i64 },
    Hop { size_ns: i64, slide_ns: i64 },
}

/// One constrained temporal join form (spec 16): telemetry LEFT JOIN
/// deployments on service, within an interval around the deployment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TemporalJoinSpec {
    pub right_table: String,
    pub lookback_ns: i64,
    pub lookahead_ns: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OrderBy {
    pub column: String,
    pub descending: bool,
}

/// A validated V1 query.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Query {
    pub projections: Vec<SelectItem>,
    pub table: String,
    pub filter: Option<Expr>,
    pub group_by: Vec<String>,
    pub window: Option<WindowSpec>,
    pub temporal_join: Option<TemporalJoinSpec>,
    pub order_by: Vec<OrderBy>,
    pub limit: Option<usize>,
}
