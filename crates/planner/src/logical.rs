//! Logical plan (TA-044): exactly the nine spec nodes - Scan, Filter,
//! Project, Aggregate, Window, TemporalJoin, Sort, Limit, Sink.

use serde::{Deserialize, Serialize};

use crate::ast::{AggregateFn, Expr, OrderBy, Query, SelectItem, TemporalJoinSpec, WindowSpec};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AggregateExpr {
    pub func: AggregateFn,
    pub arg: Option<String>,
    pub output_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProjectExpr {
    pub expr: Expr,
    pub output_name: String,
}

/// The nine logical nodes. Child-first tree.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case")]
pub enum LogicalPlan {
    Scan {
        table: String,
        /// Columns actually needed downstream (projection pruning fills it).
        columns: Vec<String>,
    },
    Filter {
        input: Box<LogicalPlan>,
        predicate: Expr,
    },
    Project {
        input: Box<LogicalPlan>,
        exprs: Vec<ProjectExpr>,
    },
    Aggregate {
        input: Box<LogicalPlan>,
        group_by: Vec<String>,
        aggregates: Vec<AggregateExpr>,
    },
    Window {
        input: Box<LogicalPlan>,
        spec: WindowSpec,
    },
    TemporalJoin {
        input: Box<LogicalPlan>,
        spec: TemporalJoinSpec,
    },
    Sort {
        input: Box<LogicalPlan>,
        order_by: Vec<OrderBy>,
    },
    Limit {
        input: Box<LogicalPlan>,
        limit: usize,
        /// Set by the optimizer when the limit was pushed into a top-k sort.
        top_k: bool,
    },
    Sink {
        input: Box<LogicalPlan>,
    },
}

impl LogicalPlan {
    /// Render as an indented tree (EXPLAIN building block).
    pub fn render(&self) -> String {
        let mut out = String::new();
        self.render_into(&mut out, 0);
        out
    }

    fn render_into(&self, out: &mut String, depth: usize) {
        let pad = "  ".repeat(depth);
        match self {
            LogicalPlan::Scan { table, columns } => {
                out.push_str(&format!("{pad}Scan {table} [{}]\n", columns.join(", ")));
            }
            LogicalPlan::Filter { input, predicate } => {
                out.push_str(&format!("{pad}Filter {predicate:?}\n"));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::Project { input, exprs } => {
                let names: Vec<&str> = exprs.iter().map(|e| e.output_name.as_str()).collect();
                out.push_str(&format!("{pad}Project [{}]\n", names.join(", ")));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::Aggregate {
                input,
                group_by,
                aggregates,
            } => {
                let aggs: Vec<String> = aggregates
                    .iter()
                    .map(|a| format!("{:?}({})", a.func, a.arg.as_deref().unwrap_or("*")))
                    .collect();
                out.push_str(&format!(
                    "{pad}Aggregate group_by=[{}] aggs=[{}]\n",
                    group_by.join(", "),
                    aggs.join(", ")
                ));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::Window { input, spec } => {
                out.push_str(&format!("{pad}Window {spec:?}\n"));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::TemporalJoin { input, spec } => {
                out.push_str(&format!(
                    "{pad}TemporalJoin {} lookback={}ns lookahead={}ns\n",
                    spec.right_table, spec.lookback_ns, spec.lookahead_ns
                ));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::Sort { input, order_by } => {
                let keys: Vec<String> = order_by
                    .iter()
                    .map(|o| format!("{}{}", o.column, if o.descending { " desc" } else { "" }))
                    .collect();
                out.push_str(&format!("{pad}Sort [{}]\n", keys.join(", ")));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::Limit {
                input,
                limit,
                top_k,
            } => {
                out.push_str(&format!(
                    "{pad}Limit {limit}{}\n",
                    if *top_k { " (top-k)" } else { "" }
                ));
                input.render_into(out, depth + 1);
            }
            LogicalPlan::Sink { input } => {
                out.push_str(&format!("{pad}Sink\n"));
                input.render_into(out, depth + 1);
            }
        }
    }
}

/// Build the initial (unoptimized) logical plan from a validated query.
pub fn build_logical_plan(query: &Query) -> LogicalPlan {
    // Scan starts with all referenced columns unknown; pruning fills them.
    let mut plan = LogicalPlan::Scan {
        table: query.table.clone(),
        columns: vec!["*".into()],
    };
    if let Some(join) = &query.temporal_join {
        plan = LogicalPlan::TemporalJoin {
            input: Box::new(plan),
            spec: join.clone(),
        };
    }
    if let Some(filter) = &query.filter {
        plan = LogicalPlan::Filter {
            input: Box::new(plan),
            predicate: filter.clone(),
        };
    }
    if let Some(window) = &query.window {
        plan = LogicalPlan::Window {
            input: Box::new(plan),
            spec: window.clone(),
        };
    }

    let aggregates: Vec<AggregateExpr> = query
        .projections
        .iter()
        .filter_map(|p| match p {
            SelectItem::Aggregate { func, arg, alias } => Some(AggregateExpr {
                func: *func,
                arg: arg.clone(),
                output_name: alias.clone().unwrap_or_else(|| {
                    format!("{:?}_{}", func, arg.clone().unwrap_or_else(|| "all".into()))
                        .to_ascii_lowercase()
                }),
            }),
            _ => None,
        })
        .collect();
    if !aggregates.is_empty() {
        plan = LogicalPlan::Aggregate {
            input: Box::new(plan),
            group_by: query.group_by.clone(),
            aggregates,
        };
    }

    // Project preserves the original select order. Aggregate outputs pass
    // through as identity columns so the projection never drops them.
    let projections: Vec<ProjectExpr> = query
        .projections
        .iter()
        .map(|p| match p {
            SelectItem::Expr { expr, alias } => ProjectExpr {
                expr: expr.clone(),
                output_name: alias.clone().unwrap_or_else(|| match expr {
                    Expr::Column(c) => c.clone(),
                    _ => "expr".into(),
                }),
            },
            SelectItem::Aggregate { func, arg, alias } => {
                let name = alias.clone().unwrap_or_else(|| {
                    format!("{:?}_{}", func, arg.clone().unwrap_or_else(|| "all".into()))
                        .to_ascii_lowercase()
                });
                ProjectExpr {
                    expr: Expr::Column(name.clone()),
                    output_name: name,
                }
            }
        })
        .collect();
    if !projections.is_empty() {
        plan = LogicalPlan::Project {
            input: Box::new(plan),
            exprs: projections,
        };
    }

    if !query.order_by.is_empty() {
        plan = LogicalPlan::Sort {
            input: Box::new(plan),
            order_by: query.order_by.clone(),
        };
    }
    if let Some(limit) = query.limit {
        plan = LogicalPlan::Limit {
            input: Box::new(plan),
            limit,
            top_k: false,
        };
    }
    LogicalPlan::Sink {
        input: Box::new(plan),
    }
}
