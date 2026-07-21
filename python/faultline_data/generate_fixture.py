"""Generate a small multi-signal synthetic incident (M2 fallback fixture)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from faultline_data.validate import validate_incident_dir

DATASET_ID = "synthetic-ob"
DATASET_VERSION = "v1"
INCIDENT_ID = "rec-mem-001"
BASE_NS = 1_700_000_000_000_000_000  # fixed for determinism
TICK = 1_000_000_000  # 1s


SERVICES = [
    "frontend",
    "checkoutservice",
    "recommendationservice",
    "cartservice",
    "productcatalogservice",
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def build_rows() -> dict[str, list[dict]]:
    metrics: list[dict] = []
    spans: list[dict] = []
    logs: list[dict] = []
    changes: list[dict] = []

    # Healthy period t=0..4, fault from t=5, recovery start t=12
    for t in range(0, 16):
        et = BASE_NS + t * TICK
        for svc in SERVICES:
            mem = 0.35
            lat = 40.0
            err = 0.0
            if t >= 5 and svc == "recommendationservice":
                mem = 0.35 + (t - 4) * 0.08
                lat = 40.0 + (t - 4) * 25.0
            if t >= 7 and svc in ("checkoutservice", "frontend"):
                lat = 40.0 + (t - 6) * 18.0
                err = min(0.25, (t - 6) * 0.03)
            metrics.append(
                {
                    "event_id": f"m-{svc}-{t}-mem",
                    "event_time_ns": et,
                    "service": svc,
                    "name": f"{svc}_mem",
                    "kind": "gauge",
                    "value": mem,
                    "unit": "ratio",
                }
            )
            metrics.append(
                {
                    "event_id": f"m-{svc}-{t}-lat",
                    "event_time_ns": et,
                    "service": svc,
                    "name": f"{svc}_latency",
                    "kind": "gauge",
                    "value": lat,
                    "unit": "ms",
                }
            )
            metrics.append(
                {
                    "event_id": f"m-{svc}-{t}-err",
                    "event_time_ns": et,
                    "service": svc,
                    "name": f"{svc}_error_rate",
                    "kind": "gauge",
                    "value": err,
                    "unit": "ratio",
                }
            )

        # Traces: frontend -> checkout -> recommendation
        for i in range(3):
            tid = f"trace-{t}-{i}"
            ok = not (t >= 8 and i == 0)
            status = "ok" if ok else "error"
            spans.append(
                {
                    "event_id": f"s-{tid}-fe",
                    "event_time_ns": et,
                    "service": "frontend",
                    "trace_id": tid,
                    "span_id": f"{tid}-1",
                    "parent_span_id": None,
                    "operation": "HTTP GET /cart",
                    "start_time_ns": et,
                    "end_time_ns": et + 30_000_000,
                    "duration_ns": 30_000_000,
                    "status": status,
                    "peer_service": "checkoutservice",
                    "span_kind": "server",
                }
            )
            spans.append(
                {
                    "event_id": f"s-{tid}-co",
                    "event_time_ns": et + 1_000_000,
                    "service": "checkoutservice",
                    "trace_id": tid,
                    "span_id": f"{tid}-2",
                    "parent_span_id": f"{tid}-1",
                    "operation": "PlaceOrder",
                    "start_time_ns": et + 1_000_000,
                    "end_time_ns": et + 25_000_000,
                    "duration_ns": 24_000_000,
                    "status": status,
                    "peer_service": "recommendationservice",
                    "span_kind": "client",
                }
            )
            rec_dur = 5_000_000 if t < 5 else 5_000_000 + (t - 4) * 4_000_000
            spans.append(
                {
                    "event_id": f"s-{tid}-rec",
                    "event_time_ns": et + 2_000_000,
                    "service": "recommendationservice",
                    "trace_id": tid,
                    "span_id": f"{tid}-3",
                    "parent_span_id": f"{tid}-2",
                    "operation": "ListRecommendations",
                    "start_time_ns": et + 2_000_000,
                    "end_time_ns": et + 2_000_000 + rec_dur,
                    "duration_ns": rec_dur,
                    "status": status,
                    "peer_service": None,
                    "span_kind": "server",
                }
            )

        if t == 5:
            changes.append(
                {
                    "event_id": "c-deploy-rec-1",
                    "event_time_ns": et,
                    "service": "recommendationservice",
                    "change_id": "deploy-rec-v2",
                    "change_type": "deployment",
                    "version_before": "v1",
                    "version_after": "v2",
                }
            )
            logs.append(
                {
                    "event_id": "l-rec-gc-1",
                    "event_time_ns": et + 500_000_000,
                    "service": "recommendationservice",
                    "severity_text": "WARN",
                    "body": "GC pause elevated after deploy",
                    "trace_id": None,
                    "span_id": None,
                }
            )
        if t == 10:
            logs.append(
                {
                    "event_id": "l-rec-mem-1",
                    "event_time_ns": et,
                    "service": "recommendationservice",
                    "severity_text": "ERROR",
                    "body": "memory pressure; cache miss storm",
                    "trace_id": "trace-10-0",
                    "span_id": "trace-10-0-3",
                }
            )

    return {
        "metrics": metrics,
        "spans": spans,
        "logs": logs,
        "changes": changes,
    }


def write_parquet(rows: list[dict], path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        table = pa.table({"event_id": pa.array([], type=pa.string())})
        pq.write_table(table, path)
        return 0
    # unify as string-encoded JSON column plus key fields for easy Rust reading
    table = pa.table(
        {
            "event_id": [r["event_id"] for r in rows],
            "event_time_ns": [r["event_time_ns"] for r in rows],
            "service": [r.get("service") for r in rows],
            "payload_json": [json.dumps(r, sort_keys=True) for r in rows],
        }
    )
    pq.write_table(table, path)
    return len(rows)


def generate(out_root: Path) -> Path:
    incident_dir = out_root / DATASET_ID / DATASET_VERSION / INCIDENT_ID
    incident_dir.mkdir(parents=True, exist_ok=True)
    rows = build_rows()
    files = []
    counts = {}
    for signal, data in rows.items():
        part = incident_dir / signal / "part-00000.parquet"
        n = write_parquet(data, part)
        counts[signal] = n
        files.append(
            {
                "path": f"{signal}/part-00000.parquet",
                "sha256": sha256_file(part),
                "rows": n,
            }
        )

    start = BASE_NS
    end = BASE_NS + 15 * TICK
    manifest = {
        "schema_version": 1,
        "dataset_id": DATASET_ID,
        "dataset_version": DATASET_VERSION,
        "incident_id": INCIDENT_ID,
        "system": "online-boutique-synthetic",
        "start_time_ns": start,
        "end_time_ns": end,
        "signals": list(rows.keys()),
        "event_counts": counts,
        "files": files,
    }
    labels = {
        "incident_id": INCIDENT_ID,
        "root_cause_services": ["recommendationservice"],
        "root_cause_indicators": ["recommendationservice_mem"],
        "fault_type": "mem",
        "fault_start_time_ns": BASE_NS + 5 * TICK,
        "fault_end_time_ns": BASE_NS + 14 * TICK,
        "expected_downstream_services": ["checkoutservice", "frontend"],
        "notes": "Synthetic MEM fault on recommendationservice after deploy (M2 fixture).",
    }
    (incident_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (incident_dir / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    validate_incident_dir(incident_dir)
    return incident_dir


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2] / "datasets" / "fixtures"
    path = generate(root)
    print(f"wrote {path}")
