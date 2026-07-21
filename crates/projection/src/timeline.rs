//! Timeline projection: event lanes at a cursor.

use faultline_common::{TelemetryEnvelope, TelemetrySignal};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub event_id: String,
    pub event_time_ns: i64,
    pub signal: String,
    pub service: Option<String>,
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TimelineProjection {
    pub projection_version: u64,
    pub cursor_event_time_ns: i64,
    pub events: Vec<TimelineEvent>,
}

pub fn build_timeline(
    envelopes: &[TelemetryEnvelope],
    cursor_event_time_ns: i64,
    projection_version: u64,
) -> TimelineProjection {
    let events: Vec<_> = envelopes
        .iter()
        .filter(|e| e.event_time_ns <= cursor_event_time_ns)
        .map(|e| TimelineEvent {
            event_id: e.event_id.as_str().to_owned(),
            event_time_ns: e.event_time_ns,
            signal: signal_name(e.signal).into(),
            service: e.service.clone(),
            summary: summarize(e),
        })
        .collect();

    TimelineProjection {
        projection_version,
        cursor_event_time_ns,
        events,
    }
}

fn signal_name(s: TelemetrySignal) -> &'static str {
    match s {
        TelemetrySignal::Metric => "metric",
        TelemetrySignal::Span => "span",
        TelemetrySignal::Log => "log",
        TelemetrySignal::Deployment => "deployment",
        TelemetrySignal::Configuration => "configuration",
        TelemetrySignal::Alert => "alert",
        TelemetrySignal::Annotation => "annotation",
        TelemetrySignal::Control => "control",
    }
}

fn summarize(e: &TelemetryEnvelope) -> String {
    use faultline_common::TelemetryPayload;
    match &e.payload {
        TelemetryPayload::Metric(m) => format!("{}={}", m.name, m.value),
        TelemetryPayload::Span(s) => format!("{} {}", s.operation, s.span_id),
        TelemetryPayload::Log(l) => l.body.clone(),
        TelemetryPayload::Change(c) => format!("{} {}", c.change_type_str(), c.change_id),
        TelemetryPayload::Control(c) => format!("control:{:?}", c.kind),
    }
}

trait ChangeTypeStr {
    fn change_type_str(&self) -> &'static str;
}

impl ChangeTypeStr for faultline_common::ChangeEvent {
    fn change_type_str(&self) -> &'static str {
        match self.change_type {
            faultline_common::ChangeType::Deployment => "deployment",
            faultline_common::ChangeType::Config => "config",
            faultline_common::ChangeType::FeatureFlag => "feature_flag",
            faultline_common::ChangeType::Rollback => "rollback",
        }
    }
}
