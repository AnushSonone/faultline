//! Faultline inference crate: deterministic, explainable root-cause inference
//! (M4, TA-030..033).
//!
//! Pipeline: envelopes -> robust baselines -> anomaly intervals -> per-service
//! feature vectors -> weighted ranking with score decomposition -> evidence
//! objects. No ground-truth labels enter this crate's pipeline; labels exist
//! only in evaluation code that compares finished rankings against them.

pub mod anomaly;
pub mod baseline;
pub mod eval;
pub mod evidence;
pub mod evidence_graph;
pub mod features;
pub mod ranking;
