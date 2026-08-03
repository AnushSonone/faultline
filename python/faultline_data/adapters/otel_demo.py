"""OpenTelemetry Demo -> normalized Faultline incident converter (TA-052).

Converts a *recorded capture* of the OpenTelemetry Demo (Astronomy Shop) into
the normalized incident layout. Live capture is a human step - see
docs/references/otel-demo-runbook.md; this module consumes its output.

Expected capture directory (produced by the runbook's collector config):
  capture/
    scenario.json   : run metadata (all 12 spec-required fields, below)
    metrics.json    : {"{service}_{metric}": [[unix_sec, value], ...]}
    traces.csv      : same columns as RCAEval traces.csv (Jaeger export)
    logs.csv        : timestamp,container_name,message

`scenario.json` MUST record (spec section 11 / TA-052):
  demo_git_commit, container_image_versions, scenario_config,
  fault_start_unix, fault_end_unix, load_generator_config, random_seed,
  ground_truth_root_cause_service, ground_truth_fault_type,
  expected_affected_services, collection_duration_sec, converter_version
"""

from __future__ import annotations

import json
from pathlib import Path

from faultline_data.adapters.rcaeval import SEC
from faultline_data.generate_fixture import sha256_file, write_parquet
from faultline_data.validate import validate_incident_dir

CONVERTER_VERSION = "0.1.0"
DATASET_ID = "otel-demo"
DATASET_VERSION = "v1"

REQUIRED_SCENARIO_FIELDS = [
    "demo_git_commit",
    "container_image_versions",
    "scenario_config",
    "fault_start_unix",
    "fault_end_unix",
    "load_generator_config",
    "random_seed",
    "ground_truth_root_cause_service",
    "ground_truth_fault_type",
    "expected_affected_services",
    "collection_duration_sec",
    "converter_version",
]


def convert_capture(capture_dir: Path, out_root: Path, incident_id: str) -> Path:
    scenario = json.loads((capture_dir / "scenario.json").read_text())
    missing = [f for f in REQUIRED_SCENARIO_FIELDS if f not in scenario]
    if missing:
        raise ValueError(f"scenario.json missing required fields: {missing}")

    # Reuse the RCAEval row builders by shaping the capture identically.
    from faultline_data.adapters import rcaeval as rc

    metrics_raw = json.loads((capture_dir / "metrics.json").read_text())
    metric_services = {key.split("_", 1)[0] for key in metrics_raw}
    metrics = []
    for series, points in sorted(metrics_raw.items()):
        service, _metric = series.split("_", 1)
        for i, (ts, value) in enumerate(points):
            if value is None:
                continue
            metrics.append(
                {
                    "event_id": f"m-{series}-{i}",
                    "event_time_ns": int(ts) * SEC,
                    "service": service,
                    "name": series,
                    "kind": "gauge",
                    "value": float(value),
                    "unit": None,
                }
            )

    import csv

    spans = []
    with (capture_dir / "traces.csv").open(newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if not rc._keep_trace(row["traceID"]):
                continue
            start_ns = int(row["startTime"]) * 1000
            duration_ns = int(float(row["duration"])) * 1000
            spans.append(
                {
                    "event_id": f"s-{i}",
                    "event_time_ns": start_ns,
                    "service": rc._norm_service(row["serviceName"], metric_services),
                    "trace_id": row["traceID"],
                    "span_id": row["spanID"],
                    "parent_span_id": row.get("parentSpanID") or None,
                    "operation": row["operationName"],
                    "start_time_ns": start_ns,
                    "end_time_ns": start_ns + duration_ns,
                    "duration_ns": duration_ns,
                    "status": "ok" if float(row["statusCode"] or 0) == 0 else "error",
                    "peer_service": None,
                    "span_kind": "server",
                }
            )

    logs = []
    logs_path = capture_dir / "logs.csv"
    if logs_path.exists():
        with logs_path.open(newline="") as f:
            for i, row in enumerate(csv.DictReader(f)):
                severe = any(h in row["message"].lower() for h in rc.ERROR_HINTS)
                logs.append(
                    {
                        "event_id": f"l-{i}",
                        "event_time_ns": int(row["timestamp"]) * SEC,
                        "service": row["container_name"],
                        "severity_text": "ERROR" if severe else "INFO",
                        "body": row["message"][:500],
                        "trace_id": None,
                        "span_id": None,
                    }
                )

    rows_by_signal = {"metrics": metrics, "spans": spans, "logs": logs, "changes": []}
    all_ts = [r["event_time_ns"] for sig in rows_by_signal.values() for r in sig]
    start_ns, end_ns = min(all_ts), max(all_ts)

    incident_dir = out_root / DATASET_ID / DATASET_VERSION / incident_id
    incident_dir.mkdir(parents=True, exist_ok=True)
    files, counts = [], {}
    for signal, data in rows_by_signal.items():
        part = incident_dir / signal / "part-00000.parquet"
        n = write_parquet(data, part)
        counts[signal] = n
        files.append(
            {"path": f"{signal}/part-00000.parquet", "sha256": sha256_file(part), "rows": n}
        )

    manifest = {
        "schema_version": 1,
        "dataset_id": DATASET_ID,
        "dataset_version": DATASET_VERSION,
        "incident_id": incident_id,
        "system": "opentelemetry-demo",
        "start_time_ns": start_ns,
        "end_time_ns": end_ns,
        "signals": list(rows_by_signal.keys()),
        "event_counts": counts,
        "files": files,
    }
    labels = {
        "incident_id": incident_id,
        "root_cause_services": [scenario["ground_truth_root_cause_service"]],
        "root_cause_indicators": [],
        "fault_type": scenario["ground_truth_fault_type"],
        "fault_start_time_ns": int(scenario["fault_start_unix"]) * SEC,
        "fault_end_time_ns": int(scenario["fault_end_unix"]) * SEC,
        "expected_downstream_services": scenario["expected_affected_services"],
        "notes": f"OTel Demo capture; scenario metadata in scenario.json (converter {CONVERTER_VERSION}).",
    }
    (incident_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (incident_dir / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    # Preserve full run metadata beside the incident.
    (incident_dir / "scenario.json").write_text(json.dumps(scenario, indent=2), encoding="utf-8")
    validate_incident_dir(incident_dir)
    return incident_dir


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("capture", type=Path)
    ap.add_argument("--incident-id", required=True)
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "datasets" / "fixtures",
    )
    args = ap.parse_args()
    print(convert_capture(args.capture, args.out, args.incident_id))
