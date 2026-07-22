//! Faultline streaming engine (M3): runtime, operators, windows, heatmap pipeline.

pub mod heatmap_pipeline;
pub mod message;
pub mod operator;
pub mod operators;
pub mod runtime;

pub use heatmap_pipeline::{HeatmapStreamingPipeline, ProjectionMode};
pub use message::{ControlMessage, RuntimeBatch, RuntimeMessage};
pub use operator::{Operator, OperatorError, OperatorMetrics, OperatorSnapshot};
pub use operators::{
    AggFn, FilterExec, HashAggregateExec, HeatmapSinkExec, Predicate, ProjectionExec, WindowEmit,
    WindowKind, WindowOperator,
};
pub use runtime::{run_bounded_chain, RuntimeError, RuntimeInspectorDto, SyncRuntime};

pub fn crate_name() -> &'static str {
    "faultline-engine"
}
