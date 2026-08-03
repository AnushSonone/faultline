//! EXPLAIN / EXPLAIN ANALYZE DTOs (TA-047, spec 16 contract).

use serde::{Deserialize, Serialize};

use crate::logical::LogicalPlan;
use crate::physical::{ExecMetrics, PhysicalPlan};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExplainOutput {
    pub statement: String,
    pub logical_plan: String,
    pub optimized_logical_plan: String,
    pub physical_plan: PhysicalPlan,
    pub operator_ids: Vec<String>,
    pub partitioning: String,
    pub state_retention: String,
    pub watermark_policy: String,
    /// Observed cardinality when ANALYZE ran; absent for plain EXPLAIN.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analyze: Option<ExecMetrics>,
}

pub fn explain(
    statement: &str,
    logical: &LogicalPlan,
    optimized: &LogicalPlan,
    physical: &PhysicalPlan,
    analyze: Option<ExecMetrics>,
) -> ExplainOutput {
    ExplainOutput {
        statement: statement.to_owned(),
        logical_plan: logical.render(),
        optimized_logical_plan: optimized.render(),
        physical_plan: physical.clone(),
        operator_ids: physical
            .operators
            .iter()
            .map(|o| o.operator_id.clone())
            .collect(),
        partitioning: physical.partitioning.clone(),
        state_retention: physical.state_retention.clone(),
        watermark_policy: physical.watermark_policy.clone(),
        analyze,
    }
}
