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


def _keep_trace(trace_id: str, buckets: int = TRACE_KEEP_BUCKETS) -> bool:
    digest = hashlib.sha256(trace_id.encode()).digest()
    return digest[0] % buckets == 0


def convert_case(
    case_dir: Path,
    out_root: Path,
    *,
    window_s: tuple[int, int] | None = None,
    trace_keep_buckets: int = TRACE_KEEP_BUCKETS,
    log_cap: int = LOG_CAP,
    dataset_id: str = DATASET_ID,
    dataset_version: str = DATASET_VERSION,
    id_suffix: str | None = None,
) -> Path:
    """Convert one RE2-OB case.

    The defaults reproduce the benchmark fixtures exactly. `window_s` keeps
    only (seconds before, seconds after) the injection, which cuts a short,
    watchable case out of a 1440 s recording; give it its own `dataset_id` or
    `dataset_version` so it never lands inside the benchmark sweep.
    """
    name = case_dir.name  # re2ob_checkoutservice_cpu_1
    parts = name.split("_")
    if len(parts) != 4 or parts[0] != "re2ob":
        raise ValueError(f"unexpected case dir name: {name}")
    _, target, fault, instance = parts
    incident_id = f"re2ob-{target}-{fault}-{instance}"
    if id_suffix:
        incident_id = f"{incident_id}-{id_suffix}"

    inject_ns = int((case_dir / "inject_time.txt").read_text().strip()) * SEC

    if window_s is not None:
        pre_s, post_s = window_s
        lo, hi = inject_ns - pre_s * SEC, inject_ns + post_s * SEC
    else:
        lo = hi = None

    def in_window(ns: int) -> bool:
        return lo is None or lo <= ns <= hi

    # Metrics: full fidelity.
    metrics_raw = json.loads((case_dir / "metrics.json").read_text())
    metric_services = {key.split("_", 1)[0] for key in metrics_raw}
    metrics = []
    for series, points in sorted(metrics_raw.items()):
        service, metric = series.split("_", 1)
        for i, (ts, value) in enumerate(points):
            if value is None or not in_window(int(ts) * SEC):
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

    # Traces: whole-trace deterministic sampling. With a window, a trace is kept
    # whole when any of its spans starts inside it, so no trace loses spans or
    # parent links at either boundary (critical-path analysis needs the DAG).
    traces_path = case_dir / "traces.csv"
    window_traces: set[str] | None = None
    if lo is not None:
        window_traces = set()
        with traces_path.open(newline="") as f:
            for row in csv.DictReader(f):
                if _keep_trace(row["traceID"], trace_keep_buckets) and in_window(
                    int(row["startTime"]) * 1000
                ):
                    window_traces.add(row["traceID"])
    spans = []
    kept_traces: set[str] = set()
    with traces_path.open(newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            trace_id = row["traceID"]
            if not _keep_trace(trace_id, trace_keep_buckets):
                continue
            if window_traces is not None and trace_id not in window_traces:
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
    # With a window, the cap applies to the lines inside it.
    with (case_dir / "logs.csv").open(newline="") as f:
        rows = [r for r in csv.DictReader(f) if in_window(int(r["timestamp"]) * SEC)]
    error_rows = [r for r in rows if any(h in r["message"].lower() for h in ERROR_HINTS)]
    sampled = error_rows[:log_cap]
    if len(sampled) < log_cap:
        step = max(1, len(rows) // (log_cap - len(sampled)))
        sampled += rows[::step][: log_cap - len(sampled)]
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

    incident_dir = out_root / dataset_id / dataset_version / incident_id
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
        "dataset_id": dataset_id,
        "dataset_version": dataset_version,
        "incident_id": incident_id,
        "system": "online-boutique (RCAEval RE2-OB)",
        "start_time_ns": start_ns,
        "end_time_ns": end_ns,
        "signals": list(rows_by_signal.keys()),
        "event_counts": counts,
        "files": files,
    }
    indicator_metric = {"cpu": "cpu", "mem": "mem", "delay": "latency-50"}.get(fault, fault)
    window_note = (
        f" Windowed to {window_s[0]} s before and {window_s[1]} s after the injection."
        if window_s is not None
        else ""
    )
    labels = {
        "incident_id": incident_id,
        "root_cause_services": [target],
        "root_cause_indicators": [f"{target}_{indicator_metric}"],
        "fault_type": fault,
        "fault_start_time_ns": inject_ns,
        "fault_end_time_ns": end_ns,
        "expected_downstream_services": [],
        "notes": (
            f"RCAEval RE2-OB case {name}; traces sampled 1/{trace_keep_buckets} "
            f"by whole trace ({len(kept_traces)} traces kept), logs capped at {log_cap}."
            f"{window_note}"
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
    ap.add_argument("--pre-s", type=int, help="window: seconds kept before the injection")
    ap.add_argument("--post-s", type=int, help="window: seconds kept after the injection")
    ap.add_argument("--trace-keep-buckets", type=int, default=TRACE_KEEP_BUCKETS)
    ap.add_argument("--log-cap", type=int, default=LOG_CAP)
    ap.add_argument("--dataset-id", default=DATASET_ID)
    ap.add_argument("--dataset-version", default=DATASET_VERSION)
    ap.add_argument("--id-suffix", help="appended to the incident id, e.g. w120")
    args = ap.parse_args()
    if (args.pre_s is None) != (args.post_s is None):
        ap.error("--pre-s and --post-s go together")
    window = (args.pre_s, args.post_s) if args.pre_s is not None else None
    for case in args.cases:
        path = convert_case(
            case,
            args.out,
            window_s=window,
            trace_keep_buckets=args.trace_keep_buckets,
            log_cap=args.log_cap,
            dataset_id=args.dataset_id,
            dataset_version=args.dataset_version,
            id_suffix=args.id_suffix,
        )
        print(f"converted {case.name} -> {path}")
