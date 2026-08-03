//! Table catalog for the V1 SQL subset (spec 16: metrics, spans, logs,
//! deployments, incidents).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnType {
    Text,
    Int,
    Float,
    Time,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub name: &'static str,
    pub column_type: ColumnType,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Table {
    pub name: &'static str,
    pub columns: Vec<Column>,
}

fn col(name: &'static str, column_type: ColumnType) -> Column {
    Column { name, column_type }
}

pub fn tables() -> Vec<Table> {
    use ColumnType::*;
    vec![
        Table {
            name: "metrics",
            columns: vec![
                col("service", Text),
                col("name", Text),
                col("value", Float),
                col("event_time", Time),
            ],
        },
        Table {
            name: "spans",
            columns: vec![
                col("service", Text),
                col("operation", Text),
                col("duration_ns", Int),
                col("status", Text),
                col("trace_id", Text),
                col("event_time", Time),
            ],
        },
        Table {
            name: "logs",
            columns: vec![
                col("service", Text),
                col("severity", Text),
                col("body", Text),
                col("event_time", Time),
            ],
        },
        Table {
            name: "deployments",
            columns: vec![
                col("service", Text),
                col("change_id", Text),
                col("change_type", Text),
                col("version_after", Text),
                col("event_time", Time),
            ],
        },
        Table {
            name: "incidents",
            columns: vec![
                col("incident_id", Text),
                col("start_time", Time),
                col("end_time", Time),
            ],
        },
    ]
}

pub fn table(name: &str) -> Option<Table> {
    tables().into_iter().find(|t| t.name == name)
}
