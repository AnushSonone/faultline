//! Load normalized incident Parquet partitions into [`TelemetryEnvelope`] lists.

use std::fs::File;
use std::path::{Path, PathBuf};

use arrow::array::{Array, StringArray};
use arrow::datatypes::DataType;
use arrow::record_batch::RecordBatch;
use faultline_catalog::{validate_incident_dir, Labels, Manifest};
use faultline_common::{
    ChangeEvent, ChangeType, EventId, LogEvent, MetricKind, MetricPoint, SpanEvent, SpanKind,
    SpanStatus, TelemetryEnvelope, TelemetryPayload, TelemetrySignal, SCHEMA_VERSION,
};
use indexmap::IndexMap;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde_json::Value;
use thiserror::Error;

/// Loaded incident with envelopes sorted by `(event_time_ns, event_id)`.
#[derive(Clone, Debug)]
pub struct LoadedIncident {
    pub dir: PathBuf,
    pub manifest: Manifest,
    pub labels: Labels,
    pub envelopes: Vec<TelemetryEnvelope>,
}

#[derive(Debug, Error)]
pub enum ReaderError {
    #[error("catalog: {0}")]
    Catalog(String),
    #[error("io: {0}")]
    Io(String),
    #[error("parquet: {0}")]
    Parquet(String),
    #[error("payload: {0}")]
    Payload(String),
}

/// Load an incident directory: validate manifest/labels, read all Parquet `payload_json`.
pub fn load_incident(dir: impl AsRef<Path>) -> Result<LoadedIncident, ReaderError> {
    let dir = dir.as_ref().to_path_buf();
    let (manifest, labels) =
        validate_incident_dir(&dir).map_err(|e| ReaderError::Catalog(e.to_string()))?;

    let mut envelopes = Vec::new();
    for file in &manifest.files {
        let path = dir.join(&file.path);
        let signal_dir = signal_from_path(&file.path)?;
        let rows = read_payload_rows(&path)?;
        for (idx, payload) in rows.into_iter().enumerate() {
            let env = payload_to_envelope(&manifest, &file.path, signal_dir, &payload)
                .map_err(|e| ReaderError::Payload(format!("{} row {idx}: {e}", file.path)))?;
            envelopes.push(env);
        }
    }

    envelopes.sort_by(|a, b| {
        a.event_time_ns
            .cmp(&b.event_time_ns)
            .then_with(|| a.event_id.as_str().cmp(b.event_id.as_str()))
    });

    Ok(LoadedIncident {
        dir,
        manifest,
        labels,
        envelopes,
    })
}

fn signal_from_path(rel: &str) -> Result<&'static str, ReaderError> {
    let first = rel
        .split(['/', '\\'])
        .next()
        .ok_or_else(|| ReaderError::Payload(format!("empty path: {rel}")))?;
    match first {
        "metrics" => Ok("metrics"),
        "spans" => Ok("spans"),
        "logs" => Ok("logs"),
        "changes" => Ok("changes"),
        other => Err(ReaderError::Payload(format!(
            "unknown signal directory '{other}' in {rel}"
        ))),
    }
}

fn read_payload_rows(path: &Path) -> Result<Vec<Value>, ReaderError> {
    if !path.exists() {
        return Err(ReaderError::Io(format!("missing file {}", path.display())));
    }
    let file = File::open(path).map_err(|e| ReaderError::Io(format!("{}: {e}", path.display())))?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| ReaderError::Parquet(e.to_string()))?;
    let reader = builder
        .build()
        .map_err(|e| ReaderError::Parquet(e.to_string()))?;

    let mut out = Vec::new();
    for batch in reader {
        let batch = batch.map_err(|e| ReaderError::Parquet(e.to_string()))?;
        out.extend(extract_payload_json(&batch)?);
    }
    Ok(out)
}

fn extract_payload_json(batch: &RecordBatch) -> Result<Vec<Value>, ReaderError> {
    let col = batch
        .column_by_name("payload_json")
        .ok_or_else(|| ReaderError::Parquet("missing payload_json column".into()))?;
    let strings = string_column(col)?;
    let mut values = Vec::with_capacity(strings.len());
    for i in 0..strings.len() {
        if strings.is_null(i) {
            continue;
        }
        let s = strings.value(i);
        let v: Value = serde_json::from_str(s)
            .map_err(|e| ReaderError::Payload(format!("payload_json parse: {e}")))?;
        values.push(v);
    }
    Ok(values)
}

fn string_column(col: &dyn Array) -> Result<&StringArray, ReaderError> {
    match col.data_type() {
        DataType::Utf8 => col
            .as_any()
            .downcast_ref::<StringArray>()
            .ok_or_else(|| ReaderError::Parquet("payload_json not StringArray".into())),
        other => Err(ReaderError::Parquet(format!(
            "payload_json expected Utf8, got {other:?}"
        ))),
    }
}

fn payload_to_envelope(
    manifest: &Manifest,
    source_id: &str,
    signal_dir: &str,
    row: &Value,
) -> Result<TelemetryEnvelope, String> {
    let event_id_str = row
        .get("event_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "event_id required".to_string())?;
    let event_time_ns = row
        .get("event_time_ns")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "event_time_ns required".to_string())?;
    let service = row
        .get("service")
        .and_then(|v| v.as_str())
        .map(str::to_owned);

    let (signal, payload) = match signal_dir {
        "metrics" => {
            let point = MetricPoint {
                name: req_str(row, "name")?,
                kind: parse_metric_kind(req_str(row, "kind")?.as_str())?,
                value: req_f64(row, "value")?,
                unit: opt_str(row, "unit"),
            };
            (TelemetrySignal::Metric, TelemetryPayload::Metric(point))
        }
        "spans" => {
            let span = SpanEvent {
                trace_id: req_str(row, "trace_id")?,
                span_id: req_str(row, "span_id")?,
                parent_span_id: opt_str(row, "parent_span_id"),
                operation: req_str(row, "operation")?,
                start_time_ns: req_i64(row, "start_time_ns")?,
                end_time_ns: req_i64(row, "end_time_ns")?,
                duration_ns: req_i64(row, "duration_ns")?,
                status: parse_span_status(req_str(row, "status")?.as_str())?,
                peer_service: opt_str(row, "peer_service"),
                span_kind: parse_span_kind(req_str(row, "span_kind")?.as_str())?,
            };
            (TelemetrySignal::Span, TelemetryPayload::Span(span))
        }
        "logs" => {
            let log = LogEvent {
                severity_number: row
                    .get("severity_number")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u8),
                severity_text: opt_str(row, "severity_text"),
                body: req_str(row, "body")?,
                template_id: opt_str(row, "template_id"),
                trace_id: opt_str(row, "trace_id"),
                span_id: opt_str(row, "span_id"),
            };
            (TelemetrySignal::Log, TelemetryPayload::Log(log))
        }
        "changes" => {
            let change_type = parse_change_type(req_str(row, "change_type")?.as_str())?;
            let signal = match change_type {
                ChangeType::Deployment | ChangeType::Rollback => TelemetrySignal::Deployment,
                ChangeType::Config | ChangeType::FeatureFlag => TelemetrySignal::Configuration,
            };
            let change = ChangeEvent {
                change_id: req_str(row, "change_id")?,
                change_type,
                version_before: opt_str(row, "version_before"),
                version_after: opt_str(row, "version_after"),
                actor: opt_str(row, "actor"),
                metadata: IndexMap::new(),
            };
            (signal, TelemetryPayload::Change(change))
        }
        other => return Err(format!("unknown signal {other}")),
    };

    Ok(TelemetryEnvelope {
        schema_version: SCHEMA_VERSION,
        event_id: EventId::new(event_id_str),
        event_time_ns,
        observed_time_ns: event_time_ns,
        ingest_time_ns: 0,
        source_id: source_id.to_owned(),
        dataset_id: manifest.dataset_id.clone(),
        incident_id: Some(manifest.incident_id.clone()),
        environment: "prod".into(),
        service,
        service_instance: None,
        host: None,
        region: None,
        signal,
        attributes: IndexMap::new(),
        payload,
    })
}

fn req_str(row: &Value, key: &str) -> Result<String, String> {
    row.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("{key} required string"))
}

fn opt_str(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| {
        if v.is_null() {
            None
        } else {
            v.as_str().map(str::to_owned)
        }
    })
}

fn req_i64(row: &Value, key: &str) -> Result<i64, String> {
    row.get(key)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| format!("{key} required i64"))
}

fn req_f64(row: &Value, key: &str) -> Result<f64, String> {
    row.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("{key} required f64"))
}

fn parse_metric_kind(s: &str) -> Result<MetricKind, String> {
    match s.to_ascii_lowercase().as_str() {
        "gauge" => Ok(MetricKind::Gauge),
        "counter" => Ok(MetricKind::Counter),
        "histogram_sample" | "histogram" => Ok(MetricKind::HistogramSample),
        other => Err(format!("unknown metric kind {other}")),
    }
}

fn parse_span_status(s: &str) -> Result<SpanStatus, String> {
    match s.to_ascii_lowercase().as_str() {
        "unset" => Ok(SpanStatus::Unset),
        "ok" => Ok(SpanStatus::Ok),
        "error" => Ok(SpanStatus::Error),
        other => Err(format!("unknown span status {other}")),
    }
}

fn parse_span_kind(s: &str) -> Result<SpanKind, String> {
    match s.to_ascii_lowercase().as_str() {
        "internal" => Ok(SpanKind::Internal),
        "server" => Ok(SpanKind::Server),
        "client" => Ok(SpanKind::Client),
        "producer" => Ok(SpanKind::Producer),
        "consumer" => Ok(SpanKind::Consumer),
        other => Err(format!("unknown span kind {other}")),
    }
}

fn parse_change_type(s: &str) -> Result<ChangeType, String> {
    match s.to_ascii_lowercase().as_str() {
        "deployment" => Ok(ChangeType::Deployment),
        "config" => Ok(ChangeType::Config),
        "feature_flag" | "featureflag" => Ok(ChangeType::FeatureFlag),
        "rollback" => Ok(ChangeType::Rollback),
        other => Err(format!("unknown change_type {other}")),
    }
}

#[cfg(test)]
mod fixture_tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn loads_synthetic_fixture() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../datasets/fixtures/synthetic-ob/v1/rec-mem-001");
        if !root.exists() {
            eprintln!("skip: fixture missing at {}", root.display());
            return;
        }
        let loaded = load_incident(&root).expect("load fixture");
        assert!(loaded.envelopes.len() > 100, "expected many envelopes");
        assert_eq!(loaded.manifest.incident_id, "rec-mem-001");
        // sorted by event time
        for w in loaded.envelopes.windows(2) {
            assert!(w[0].event_time_ns <= w[1].event_time_ns);
        }
    }
}
