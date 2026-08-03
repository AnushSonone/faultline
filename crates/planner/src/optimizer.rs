//! Optimizer (TA-045): the spec 16 rewrite rules, applied in order.
//! 1 predicate pushdown, 2 projection pruning, 3 constant folding,
//! 4 filter combination, 5 no-op projection removal, 6 LIMIT -> TopK.
//! Rule 7 (shared scans) waits for multi-query execution.

use std::collections::BTreeSet;

use crate::ast::{BinaryOp, Expr, Literal};
use crate::logical::LogicalPlan;

pub fn optimize(plan: LogicalPlan) -> LogicalPlan {
    let plan = push_down_predicates(plan);
    let plan = combine_filters(plan);
    let plan = fold_constants(plan);
    let plan = prune_projections(plan);
    let plan = remove_noop_projections(plan);
    push_limit_into_topk(plan)
}

/// Rule 1: move Filter below Window (filters reference scan columns only in
/// V1, so pushing below stateless/window nodes is safe; never below
/// TemporalJoin when the predicate mentions join-produced columns).
fn push_down_predicates(plan: LogicalPlan) -> LogicalPlan {
    map_plan(plan, &|node| match node {
        LogicalPlan::Window { input, spec } => {
            if let LogicalPlan::Filter { .. } = *input {
                return LogicalPlan::Window { input, spec };
            }
            LogicalPlan::Window { input, spec }
        }
        LogicalPlan::Filter { input, predicate } => match *input {
            LogicalPlan::Window {
                input: winner,
                spec,
            } => LogicalPlan::Window {
                input: Box::new(LogicalPlan::Filter {
                    input: winner,
                    predicate,
                }),
                spec,
            },
            LogicalPlan::TemporalJoin { input: jin, spec }
                if !references_join_columns(&predicate) =>
            {
                LogicalPlan::TemporalJoin {
                    input: Box::new(LogicalPlan::Filter {
                        input: jin,
                        predicate,
                    }),
                    spec,
                }
            }
            other => LogicalPlan::Filter {
                input: Box::new(other),
                predicate,
            },
        },
        other => other,
    })
}

fn references_join_columns(e: &Expr) -> bool {
    match e {
        Expr::Column(c) => {
            matches!(
                c.as_str(),
                "change_id" | "change_type" | "version_after" | "delay_ns"
            )
        }
        Expr::Literal(_) => false,
        Expr::Binary { left, right, .. } => {
            references_join_columns(left) || references_join_columns(right)
        }
        Expr::Not(inner) => references_join_columns(inner),
    }
}

/// Rule 4: adjacent filters combine into one AND.
fn combine_filters(plan: LogicalPlan) -> LogicalPlan {
    map_plan(plan, &|node| match node {
        LogicalPlan::Filter { input, predicate } => match *input {
            LogicalPlan::Filter {
                input: inner,
                predicate: inner_pred,
            } => LogicalPlan::Filter {
                input: inner,
                predicate: Expr::Binary {
                    left: Box::new(inner_pred),
                    op: BinaryOp::And,
                    right: Box::new(predicate),
                },
            },
            other => LogicalPlan::Filter {
                input: Box::new(other),
                predicate,
            },
        },
        other => other,
    })
}

/// Rule 3: fold constant boolean/arithmetic subtrees.
fn fold_constants(plan: LogicalPlan) -> LogicalPlan {
    map_plan(plan, &|node| match node {
        LogicalPlan::Filter { input, predicate } => {
            let folded = fold_expr(predicate);
            // A literal TRUE predicate is a no-op filter.
            if matches!(folded, Expr::Literal(Literal::Int(1))) {
                *input
            } else {
                LogicalPlan::Filter {
                    input,
                    predicate: folded,
                }
            }
        }
        other => other,
    })
}

fn fold_expr(e: Expr) -> Expr {
    match e {
        Expr::Binary { left, op, right } => {
            let left = fold_expr(*left);
            let right = fold_expr(*right);
            if let (Expr::Literal(a), Expr::Literal(b)) = (&left, &right) {
                if let Some(folded) = fold_literals(a, op, b) {
                    return Expr::Literal(folded);
                }
            }
            Expr::Binary {
                left: Box::new(left),
                op,
                right: Box::new(right),
            }
        }
        Expr::Not(inner) => {
            let inner = fold_expr(*inner);
            if let Expr::Literal(Literal::Int(v)) = inner {
                return Expr::Literal(Literal::Int(if v == 0 { 1 } else { 0 }));
            }
            Expr::Not(Box::new(inner))
        }
        other => other,
    }
}

fn fold_literals(a: &Literal, op: BinaryOp, b: &Literal) -> Option<Literal> {
    let num = |l: &Literal| -> Option<f64> {
        match l {
            Literal::Int(i) => Some(*i as f64),
            Literal::Float(f) => Some(*f),
            Literal::Text(_) => None,
        }
    };
    let (x, y) = (num(a)?, num(b)?);
    let bool_lit = |v: bool| Literal::Int(if v { 1 } else { 0 });
    Some(match op {
        BinaryOp::Add => Literal::Float(x + y),
        BinaryOp::Sub => Literal::Float(x - y),
        BinaryOp::Mul => Literal::Float(x * y),
        BinaryOp::Div => Literal::Float(x / y),
        BinaryOp::Eq => bool_lit(x == y),
        BinaryOp::NotEq => bool_lit(x != y),
        BinaryOp::Lt => bool_lit(x < y),
        BinaryOp::LtEq => bool_lit(x <= y),
        BinaryOp::Gt => bool_lit(x > y),
        BinaryOp::GtEq => bool_lit(x >= y),
        BinaryOp::And => bool_lit(x != 0.0 && y != 0.0),
        BinaryOp::Or => bool_lit(x != 0.0 || y != 0.0),
        BinaryOp::Like => return None,
    })
}

/// Rule 2: collect every referenced column and narrow the Scan.
fn prune_projections(plan: LogicalPlan) -> LogicalPlan {
    let mut needed: BTreeSet<String> = BTreeSet::new();
    collect_columns(&plan, &mut needed);
    map_plan(plan, &|node| match node {
        LogicalPlan::Scan { table, .. } => {
            let columns: Vec<String> = crate::catalog::table(&table)
                .map(|t| {
                    t.columns
                        .iter()
                        .map(|c| c.name.to_owned())
                        .filter(|c| needed.contains(c) || c == "event_time" || c == "service")
                        .collect()
                })
                .unwrap_or_default();
            LogicalPlan::Scan { table, columns }
        }
        other => other,
    })
}

fn collect_columns(plan: &LogicalPlan, out: &mut BTreeSet<String>) {
    fn walk_expr(e: &Expr, out: &mut BTreeSet<String>) {
        match e {
            Expr::Column(c) => {
                out.insert(c.clone());
            }
            Expr::Literal(_) => {}
            Expr::Binary { left, right, .. } => {
                walk_expr(left, out);
                walk_expr(right, out);
            }
            Expr::Not(inner) => walk_expr(inner, out),
        }
    }
    match plan {
        LogicalPlan::Scan { .. } => {}
        LogicalPlan::Filter { input, predicate } => {
            walk_expr(predicate, out);
            collect_columns(input, out);
        }
        LogicalPlan::Project { input, exprs } => {
            for e in exprs {
                walk_expr(&e.expr, out);
            }
            collect_columns(input, out);
        }
        LogicalPlan::Aggregate {
            input,
            group_by,
            aggregates,
        } => {
            out.extend(group_by.iter().cloned());
            for a in aggregates {
                if let Some(arg) = &a.arg {
                    out.insert(arg.clone());
                }
            }
            collect_columns(input, out);
        }
        LogicalPlan::Window { input, .. }
        | LogicalPlan::TemporalJoin { input, .. }
        | LogicalPlan::Sink { input } => collect_columns(input, out),
        LogicalPlan::Sort { input, order_by } => {
            out.extend(order_by.iter().map(|o| o.column.clone()));
            collect_columns(input, out);
        }
        LogicalPlan::Limit { input, .. } => collect_columns(input, out),
    }
}

/// Rule 5: a Project that projects every input column unchanged is a no-op.
fn remove_noop_projections(plan: LogicalPlan) -> LogicalPlan {
    map_plan(plan, &|node| match node {
        LogicalPlan::Project { input, exprs } => {
            let all_identity = exprs
                .iter()
                .all(|p| matches!(&p.expr, Expr::Column(c) if *c == p.output_name));
            // Identity over an Aggregate output is still a no-op reorder.
            if all_identity {
                if let LogicalPlan::Aggregate { .. } = input.as_ref() {
                    return *input;
                }
            }
            LogicalPlan::Project { input, exprs }
        }
        other => other,
    })
}

/// Rule 6: Limit directly above Sort becomes a top-k sort.
fn push_limit_into_topk(plan: LogicalPlan) -> LogicalPlan {
    map_plan(plan, &|node| match node {
        LogicalPlan::Limit {
            input,
            limit,
            top_k: _,
        } => match *input {
            LogicalPlan::Sort {
                input: sorted,
                order_by,
            } => LogicalPlan::Limit {
                input: Box::new(LogicalPlan::Sort {
                    input: sorted,
                    order_by,
                }),
                limit,
                top_k: true,
            },
            other => LogicalPlan::Limit {
                input: Box::new(other),
                limit,
                top_k: false,
            },
        },
        other => other,
    })
}

/// Bottom-up structural map.
fn map_plan(plan: LogicalPlan, f: &dyn Fn(LogicalPlan) -> LogicalPlan) -> LogicalPlan {
    let mapped = match plan {
        LogicalPlan::Scan { table, columns } => LogicalPlan::Scan { table, columns },
        LogicalPlan::Filter { input, predicate } => LogicalPlan::Filter {
            input: Box::new(map_plan(*input, f)),
            predicate,
        },
        LogicalPlan::Project { input, exprs } => LogicalPlan::Project {
            input: Box::new(map_plan(*input, f)),
            exprs,
        },
        LogicalPlan::Aggregate {
            input,
            group_by,
            aggregates,
        } => LogicalPlan::Aggregate {
            input: Box::new(map_plan(*input, f)),
            group_by,
            aggregates,
        },
        LogicalPlan::Window { input, spec } => LogicalPlan::Window {
            input: Box::new(map_plan(*input, f)),
            spec,
        },
        LogicalPlan::TemporalJoin { input, spec } => LogicalPlan::TemporalJoin {
            input: Box::new(map_plan(*input, f)),
            spec,
        },
        LogicalPlan::Sort { input, order_by } => LogicalPlan::Sort {
            input: Box::new(map_plan(*input, f)),
            order_by,
        },
        LogicalPlan::Limit {
            input,
            limit,
            top_k,
        } => LogicalPlan::Limit {
            input: Box::new(map_plan(*input, f)),
            limit,
            top_k,
        },
        LogicalPlan::Sink { input } => LogicalPlan::Sink {
            input: Box::new(map_plan(*input, f)),
        },
    };
    f(mapped)
}
