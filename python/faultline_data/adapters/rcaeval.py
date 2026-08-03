"""RCAEval RE2-OB -> normalized Faultline incident converter (TA-005/TA-048).

Verified against RCAEval-v2 (Figshare file 60960049, sha256 72006b45...):
each case dir `re2ob_{service}_{fault}_{instance}` holds
  - inject_time.txt : unix seconds of fault injection
  - metrics.json    : {"{service}_{metric}": [[unix_sec, value], ...]}
  - logs.csv        : timestamp,container_name,message
  - traces.csv      : time,traceID,spanID,serviceName,methodName,
                      operationName,startTimeMillis,startTime(us),
                      duration(us),statusCode,parentSpanID

Ground truth comes from the directory name + inject time (per the RCAEval
paper). Trace volume (~300k spans/case) is downsampled deterministically by
whole trace; metrics are kept in full. Sampling parameters are recorded in
the incident labels notes.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

from faultline_data.generate_fixture import sha256_file, write_parquet
from faultline_data.validate import validate_incident_dir

DATASET_ID = "rcaeval-re2-ob"
DATASET_VERSION = "v2"
SEC = 1_000_000_000

# Trace sampling: keep whole traces whose id hashes into the kept bucket.
TRACE_KEEP_BUCKETS = 8  # keep ~1/8 of traces
LOG_CAP = 4000

ERROR_HINTS = ("error", "fail", "exception", "panic", "timeout", "refused")


def _norm_service(name: str, known: set[str]) -> str:
    if name in known:
        return name
    if name.endswith("service") and name[: -len("service")] in known:
        return name[: -len("service")]
    return name


def _keep_trace(trace_id: str) -> bool:
    digest = hashlib.sha256(trace_id.encode()).digest()
    return digest[0] % TRACE_KEEP_BUCKETS == 0


def convert_case(case_dir: Path, out_root: Path) -> Path:
    name = case_dir.name  # re2ob_checkoutservice_cpu_1
    parts = name.split("_")
    if len(parts) != 4 or parts[0] != "re2ob":
        raise ValueError(f"unexpected case dir name: {name}")
    _, target, fault, instance = parts
    incident_id = f"re2ob-{target}-{fault}-{instance}"

    inject_ns = int((case_dir / "inject_time.txt").read_text().strip()) * SEC

    # Metrics: full fidelity.
    metrics_raw = json.loads((case_dir / "metrics.json").read_text())
    metric_services = {key.split("_", 1)[0] for key in metrics_raw}
    metrics = []
    for series, points in sorted(metrics_raw.items()):
        service, metric = series.split("_", 1)
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

    # Traces: whole-trace deterministic sampling.
    spans = []
    kept_traces: set[str] = set()
    with (case_dir / "traces.csv").open(newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            trace_id = row["traceID"]
            if not _keep_trace(trace_id):
                continue
            kept_traces.add(trace_id)
            start_ns = int(row["startTime"]) * 1000
            duration_ns = int(float(row["duration"])) * 1000
            status = "ok" if float(row["statusCode"] or 0) == 0 else "error"
            parent = row.get("parentSpanID") or None
            spans.append(
                {
                    "event_id": f"s-{i}",
                    "event_time_ns": start_ns,
                    "service": _norm_service(row["serviceName"], metric_services),
                    "trace_id": trace_id,
                    "span_id": row["spanID"],
                    "parent_span_id": parent if parent else None,
                    "operation": row["operationName"],
                    "start_time_ns": start_ns,
                    "end_time_ns": start_ns + duration_ns,
                    "duration_ns": duration_ns,
                    "status": status,
                    "peer_service": None,
                    "span_kind": "server",
                }
            )

    # Logs: keep error-looking lines first, then a deterministic sample.
    logs = []
    with (case_dir / "logs.csv").open(newline="") as f:
        rows = list(csv.DictReader(f))
    error_rows = [r for r in rows if any(h in r["message"].lower() for h in ERROR_HINTS)]
    sampled = error_rows[:LOG_CAP]
    if len(sampled) < LOG_CAP:
        step = max(1, len(rows) // (LOG_CAP - len(sampled)))
        sampled += rows[::step][: LOG_CAP - len(sampled)]
    for i, row in enumerate(sampled):
        severe = any(h in row["message"].lower() for h in ERROR_HINTS)
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
    logs.sort(key=lambda r: (r["event_time_ns"], r["event_id"]))

    rows_by_signal = {
        "metrics": metrics,
        "spans": spans,
        "logs": logs,
        "changes": [],  # RCAEval injects faults; no deployment events exist.
    }

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
        "system": "online-boutique (RCAEval RE2-OB)",
        "start_time_ns": start_ns,
        "end_time_ns": end_ns,
        "signals": list(rows_by_signal.keys()),
        "event_counts": counts,
        "files": files,
    }
    indicator_metric = {"cpu": "cpu", "mem": "mem", "delay": "latency-50"}.get(fault, fault)
    labels = {
        "incident_id": incident_id,
        "root_cause_services": [target],
        "root_cause_indicators": [f"{target}_{indicator_metric}"],
        "fault_type": fault,
        "fault_start_time_ns": inject_ns,
        "fault_end_time_ns": end_ns,
        "expected_downstream_services": [],
        "notes": (
            f"RCAEval RE2-OB case {name}; traces sampled 1/{TRACE_KEEP_BUCKETS} "
            f"by whole trace ({len(kept_traces)} traces kept), logs capped at {LOG_CAP}."
        ),
    }
    (incident_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (incident_dir / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    validate_incident_dir(incident_dir)
    return incident_dir


def describe_expected_layout() -> str:
    return __doc__ or ""


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="+", type=Path, help="re2ob_* case directories")
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "datasets" / "fixtures",
    )
    args = ap.parse_args()
    for case in args.cases:
        path = convert_case(case, args.out)
        print(f"converted {case.name} -> {path}")
