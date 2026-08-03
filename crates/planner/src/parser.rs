//! SQL -> Faultline AST (TA-043). sqlparser-rs for syntax only; out-of-scope
//! constructs are rejected with explicit errors (spec 16 exclusion list).

use sqlparser::ast as sql;
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

use crate::ast::{
    AggregateFn, BinaryOp, Expr, Literal, OrderBy, Query, SelectItem, TemporalJoinSpec, WindowSpec,
};
use crate::catalog;

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("syntax: {0}")]
    Syntax(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("validation: {0}")]
    Validation(String),
}

pub fn parse(sql_text: &str) -> Result<Query, ParseError> {
    let statements = Parser::parse_sql(&GenericDialect {}, sql_text)
        .map_err(|e| ParseError::Syntax(e.to_string()))?;
    let [statement] = statements.as_slice() else {
        return Err(ParseError::Unsupported(
            "exactly one statement per query".into(),
        ));
    };
    let sql::Statement::Query(query) = statement else {
        return Err(ParseError::Unsupported(
            "only SELECT statements are supported".into(),
        ));
    };
    if query.with.is_some() {
        return Err(ParseError::Unsupported(
            "CTEs are not in the V1 subset".into(),
        ));
    }
    let sql::SetExpr::Select(select) = query.body.as_ref() else {
        return Err(ParseError::Unsupported(
            "set operations are not in the V1 subset".into(),
        ));
    };
    if select.distinct.is_some() {
        return Err(ParseError::Unsupported(
            "DISTINCT is not in the V1 subset".into(),
        ));
    }

    // FROM + optional single temporal join.
    let [table_with_joins] = select.from.as_slice() else {
        return Err(ParseError::Unsupported("exactly one FROM table".into()));
    };
    let table = match &table_with_joins.relation {
        sql::TableFactor::Table { name, .. } => name.to_string().to_ascii_lowercase(),
        _ => return Err(ParseError::Unsupported("subqueries in FROM".into())),
    };
    let schema = catalog::table(&table)
        .ok_or_else(|| ParseError::Validation(format!("unknown table {table}")))?;

    let temporal_join = match table_with_joins.joins.as_slice() {
        [] => None,
        [join] => Some(convert_temporal_join(join)?),
        _ => return Err(ParseError::Unsupported("at most one JOIN".into())),
    };

    // Projections.
    let mut projections = Vec::new();
    let mut window = None;
    for item in &select.projection {
        match item {
            sql::SelectItem::UnnamedExpr(e) => {
                push_projection(e, None, &mut projections, &mut window)?
            }
            sql::SelectItem::ExprWithAlias { expr, alias } => push_projection(
                expr,
                Some(alias.value.clone()),
                &mut projections,
                &mut window,
            )?,
            _ => return Err(ParseError::Unsupported("wildcard projections".into())),
        }
    }

    // WHERE.
    let filter = select.selection.as_ref().map(convert_expr).transpose()?;

    // GROUP BY: plain columns, TUMBLE/HOP allowed and captured as window.
    let mut group_by = Vec::new();
    if let sql::GroupByExpr::Expressions(exprs, _) = &select.group_by {
        for e in exprs {
            if let Some(w) = try_window_fn(e)? {
                if window.replace(w).is_some() {
                    return Err(ParseError::Unsupported("one window per query".into()));
                }
            } else if let sql::Expr::Identifier(ident) = e {
                group_by.push(ident.value.to_ascii_lowercase());
            } else {
                return Err(ParseError::Unsupported(format!("GROUP BY expression {e}")));
            }
        }
    }

    // ORDER BY only for bounded results (needs LIMIT).
    let mut order_by = Vec::new();
    if let Some(ob) = &query.order_by {
        for o in &ob.exprs {
            let sql::Expr::Identifier(ident) = &o.expr else {
                return Err(ParseError::Unsupported("ORDER BY expression".into()));
            };
            order_by.push(OrderBy {
                column: ident.value.to_ascii_lowercase(),
                descending: !o.asc.unwrap_or(true),
            });
        }
    }

    if query.offset.is_some() {
        return Err(ParseError::Unsupported("OFFSET".into()));
    }
    let limit = match &query.limit {
        None => None,
        Some(sql::Expr::Value(sql::Value::Number(n, _))) => Some(
            n.parse::<usize>()
                .map_err(|_| ParseError::Validation("bad LIMIT".into()))?,
        ),
        Some(_) => return Err(ParseError::Unsupported("non-numeric LIMIT".into())),
    };
    if !order_by.is_empty() && limit.is_none() {
        return Err(ParseError::Validation(
            "ORDER BY requires LIMIT (unbounded sort is out of scope)".into(),
        ));
    }

    let q = Query {
        projections,
        table,
        filter,
        group_by,
        window,
        temporal_join,
        order_by,
        limit,
    };
    validate_columns(&q, &schema)?;
    Ok(q)
}

fn push_projection(
    e: &sql::Expr,
    alias: Option<String>,
    projections: &mut Vec<SelectItem>,
    window: &mut Option<WindowSpec>,
) -> Result<(), ParseError> {
    if let Some(w) = try_window_fn(e)? {
        // TUMBLE(...) in the projection defines the window and projects the
        // window start.
        if window.replace(w).is_some() {
            return Err(ParseError::Unsupported("one window per query".into()));
        }
        projections.push(SelectItem::Expr {
            expr: Expr::Column("window_start".into()),
            alias: alias.or(Some("window_start".into())),
        });
        return Ok(());
    }
    if let sql::Expr::Function(f) = e {
        let name = f.name.to_string().to_ascii_uppercase();
        if let Some(func) = aggregate_fn(&name) {
            let arg = first_function_arg(f)?;
            projections.push(SelectItem::Aggregate { func, arg, alias });
            return Ok(());
        }
        return Err(ParseError::Unsupported(format!("function {name}")));
    }
    projections.push(SelectItem::Expr {
        expr: convert_expr(e)?,
        alias,
    });
    Ok(())
}

fn aggregate_fn(name: &str) -> Option<AggregateFn> {
    match name {
        "COUNT" => Some(AggregateFn::Count),
        "SUM" => Some(AggregateFn::Sum),
        "AVG" => Some(AggregateFn::Avg),
        "MIN" => Some(AggregateFn::Min),
        "MAX" => Some(AggregateFn::Max),
        "P50" => Some(AggregateFn::P50),
        "P95" => Some(AggregateFn::P95),
        "P99" => Some(AggregateFn::P99),
        _ => None,
    }
}

fn first_function_arg(f: &sql::Function) -> Result<Option<String>, ParseError> {
    let sql::FunctionArguments::List(list) = &f.args else {
        return Ok(None);
    };
    match list.args.first() {
        None => Ok(None),
        Some(sql::FunctionArg::Unnamed(sql::FunctionArgExpr::Expr(sql::Expr::Identifier(
            ident,
        )))) => Ok(Some(ident.value.to_ascii_lowercase())),
        Some(sql::FunctionArg::Unnamed(sql::FunctionArgExpr::Wildcard)) => Ok(None),
        Some(other) => Err(ParseError::Unsupported(format!("aggregate arg {other}"))),
    }
}

/// TUMBLE(event_time, '1s') / HOP(event_time, '2s', '1s').
fn try_window_fn(e: &sql::Expr) -> Result<Option<WindowSpec>, ParseError> {
    let sql::Expr::Function(f) = e else {
        return Ok(None);
    };
    let name = f.name.to_string().to_ascii_uppercase();
    if name != "TUMBLE" && name != "HOP" {
        return Ok(None);
    }
    let sql::FunctionArguments::List(list) = &f.args else {
        return Err(ParseError::Unsupported(format!("{name} without args")));
    };
    let durations: Vec<i64> = list
        .args
        .iter()
        .skip(1) // first arg is the time column
        .map(|a| match a {
            sql::FunctionArg::Unnamed(sql::FunctionArgExpr::Expr(sql::Expr::Value(
                sql::Value::SingleQuotedString(s),
            ))) => parse_duration_ns(s),
            other => Err(ParseError::Unsupported(format!("window arg {other}"))),
        })
        .collect::<Result<_, _>>()?;
    match (name.as_str(), durations.as_slice()) {
        ("TUMBLE", [size]) => Ok(Some(WindowSpec::Tumble { size_ns: *size })),
        ("HOP", [size, slide]) => Ok(Some(WindowSpec::Hop {
            size_ns: *size,
            slide_ns: *slide,
        })),
        _ => Err(ParseError::Validation(format!("{name} arity"))),
    }
}

/// '1s', '500ms', '2m'.
fn parse_duration_ns(s: &str) -> Result<i64, ParseError> {
    let (digits, unit): (String, String) = s.chars().partition(|c| c.is_ascii_digit());
    let n: i64 = digits
        .parse()
        .map_err(|_| ParseError::Validation(format!("bad duration {s}")))?;
    let mult = match unit.as_str() {
        "ns" => 1,
        "ms" => 1_000_000,
        "s" => 1_000_000_000,
        "m" => 60_000_000_000,
        _ => return Err(ParseError::Validation(format!("bad duration unit {s}"))),
    };
    Ok(n * mult)
}

/// `JOIN deployments ON service WITHIN(...)` is approximated in V1 by
/// `JOIN deployments ON metrics.service = deployments.service` with fixed
/// spec intervals (matches the product temporal join configuration).
fn convert_temporal_join(join: &sql::Join) -> Result<TemporalJoinSpec, ParseError> {
    let right_table = match &join.relation {
        sql::TableFactor::Table { name, .. } => name.to_string().to_ascii_lowercase(),
        _ => return Err(ParseError::Unsupported("join subquery".into())),
    };
    if right_table != "deployments" {
        return Err(ParseError::Unsupported(
            "V1 temporal join right side must be deployments".into(),
        ));
    }
    match &join.join_operator {
        sql::JoinOperator::LeftOuter(_) | sql::JoinOperator::Inner(_) => {}
        other => return Err(ParseError::Unsupported(format!("join operator {other:?}"))),
    }
    Ok(TemporalJoinSpec {
        right_table,
        lookback_ns: 5_000_000_000,
        lookahead_ns: 10_000_000_000,
    })
}

fn convert_expr(e: &sql::Expr) -> Result<Expr, ParseError> {
    Ok(match e {
        sql::Expr::Identifier(ident) => Expr::Column(ident.value.to_ascii_lowercase()),
        sql::Expr::CompoundIdentifier(parts) => Expr::Column(
            parts
                .last()
                .map(|p| p.value.to_ascii_lowercase())
                .unwrap_or_default(),
        ),
        sql::Expr::Value(v) => Expr::Literal(match v {
            sql::Value::Number(n, _) => {
                if n.contains('.') {
                    Literal::Float(
                        n.parse()
                            .map_err(|_| ParseError::Validation(format!("bad number {n}")))?,
                    )
                } else {
                    Literal::Int(
                        n.parse()
                            .map_err(|_| ParseError::Validation(format!("bad number {n}")))?,
                    )
                }
            }
            sql::Value::SingleQuotedString(s) => Literal::Text(s.clone()),
            other => return Err(ParseError::Unsupported(format!("literal {other}"))),
        }),
        sql::Expr::BinaryOp { left, op, right } => {
            let op = match op {
                sql::BinaryOperator::Eq => BinaryOp::Eq,
                sql::BinaryOperator::NotEq => BinaryOp::NotEq,
                sql::BinaryOperator::Lt => BinaryOp::Lt,
                sql::BinaryOperator::LtEq => BinaryOp::LtEq,
                sql::BinaryOperator::Gt => BinaryOp::Gt,
                sql::BinaryOperator::GtEq => BinaryOp::GtEq,
                sql::BinaryOperator::And => BinaryOp::And,
                sql::BinaryOperator::Or => BinaryOp::Or,
                sql::BinaryOperator::Plus => BinaryOp::Add,
                sql::BinaryOperator::Minus => BinaryOp::Sub,
                sql::BinaryOperator::Multiply => BinaryOp::Mul,
                sql::BinaryOperator::Divide => BinaryOp::Div,
                other => return Err(ParseError::Unsupported(format!("operator {other}"))),
            };
            Expr::Binary {
                left: Box::new(convert_expr(left)?),
                op,
                right: Box::new(convert_expr(right)?),
            }
        }
        sql::Expr::Like {
            expr,
            pattern,
            negated,
            ..
        } => {
            let like = Expr::Binary {
                left: Box::new(convert_expr(expr)?),
                op: BinaryOp::Like,
                right: Box::new(convert_expr(pattern)?),
            };
            if *negated {
                Expr::Not(Box::new(like))
            } else {
                like
            }
        }
        sql::Expr::UnaryOp {
            op: sql::UnaryOperator::Not,
            expr,
        } => Expr::Not(Box::new(convert_expr(expr)?)),
        sql::Expr::Nested(inner) => convert_expr(inner)?,
        sql::Expr::Subquery(_) => {
            return Err(ParseError::Unsupported(
                "subqueries are not in the V1 subset".into(),
            ))
        }
        other => return Err(ParseError::Unsupported(format!("expression {other}"))),
    })
}

/// Every referenced column must exist on the table (or be window_start /
/// join-produced).
fn validate_columns(q: &Query, schema: &crate::catalog::Table) -> Result<(), ParseError> {
    let mut known: Vec<String> = schema.columns.iter().map(|c| c.name.to_owned()).collect();
    known.push("window_start".into());
    if q.temporal_join.is_some() {
        for extra in ["change_id", "change_type", "version_after", "delay_ns"] {
            known.push(extra.into());
        }
    }
    let mut check = |name: &str| -> Result<(), ParseError> {
        if known.iter().any(|k| k == name) {
            Ok(())
        } else {
            Err(ParseError::Validation(format!(
                "unknown column {name} on table {}",
                q.table
            )))
        }
    };
    fn walk_expr(
        e: &Expr,
        check: &mut dyn FnMut(&str) -> Result<(), ParseError>,
    ) -> Result<(), ParseError> {
        match e {
            Expr::Column(c) => check(c),
            Expr::Literal(_) => Ok(()),
            Expr::Binary { left, right, .. } => {
                walk_expr(left, check)?;
                walk_expr(right, check)
            }
            Expr::Not(inner) => walk_expr(inner, check),
        }
    }
    for p in &q.projections {
        match p {
            SelectItem::Expr { expr, .. } => walk_expr(expr, &mut check)?,
            SelectItem::Aggregate { arg: Some(a), .. } => check(a)?,
            SelectItem::Aggregate { arg: None, .. } => {}
        }
    }
    if let Some(f) = &q.filter {
        walk_expr(f, &mut check)?;
    }
    for g in &q.group_by {
        check(g)?;
    }
    for o in &q.order_by {
        // ORDER BY may reference aliases of projections.
        let aliased = q.projections.iter().any(|p| match p {
            SelectItem::Expr { alias, .. } | SelectItem::Aggregate { alias, .. } => {
                alias.as_deref() == Some(o.column.as_str())
            }
        });
        if !aliased {
            check(&o.column)?;
        }
    }
    Ok(())
}
