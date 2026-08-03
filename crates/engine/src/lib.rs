//! Faultline streaming engine (M3): runtime, operators, windows, heatmap pipeline.

pub mod heatmap_pipeline;
pub mod message;
pub mod operator;
pub mod operators;
pub mod runtime;
pub mod runtime_projection;

pub use heatmap_pipeline::{HeatmapStreamingPipeline, ProjectionMode};
pub use message::{ControlMessage, RuntimeBatch, RuntimeMessage};
pub use operator::{Operator, OperatorError, OperatorMetrics, OperatorSnapshot};
pub use operators::{
    exact_percentile_sorted, AggFn, BoundedPercentileSketch, FilterExec, HashAggregateExec,
    HeatmapSinkExec, JoinEmit, PercentileEmit, PercentileKind, PercentileOperator, Predicate,
    ProjectionExec, TemporalIntervalJoin, WindowEmit, WindowKind, WindowOperator,
    ACCEPTABLE_RELATIVE_ERROR, DEFAULT_SKETCH_ALPHA,
};
pub use runtime::{run_bounded_chain, RuntimeError, SyncRuntime};
pub use runtime_projection::{
    default_architecture_status, RuntimeInspectorDto, RUNTIME_PROJECTION_VERSION,
};
