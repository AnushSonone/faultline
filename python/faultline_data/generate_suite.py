"""Parameterized multi-incident evaluation suite generator (TA-048).

Produces N labeled synthetic incidents across fault types (mem, cpu,
latency, error) and target services, split-by-incident by construction.
Deterministic per seed. The original rec-mem-001 fixture is left untouched.

Usage: python -m faultline_data.generate_suite [--out DIR] [--seed 7]
"""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path

from faultline_data.generate_fixture import TICK, sha256_file, write_parquet
from faultline_data.validate import validate_incident_dir

DATASET_ID = "synthetic-ob"
DATASET_VERSION = "v1"
SUITE_BASE_NS = 1_710_000_000_000_000_000  # distinct epoch from rec-mem-001

# Two call routes so four distinct services can be root causes.
#   route A: frontend -> checkoutservice -> recommendationservice
#   route B: frontend -> cartservice -> productcatalogservice
ROUTES = {
    "A": ["frontend", "checkoutservice", "recommendationservice"],
    "B": ["frontend", "cartservice", "productcatalogservice"],
}
SERVICES = sorted({svc for route in ROUTES.values() for svc in route})

FAULT_TYPES = ["mem", "cpu", "latency", "error"]
TARGETS = [
    "recommendationservice",
    "checkoutservice",
    "cartservice",
    "productcatalogservice",
]
TICKS = 20


@dataclass(frozen=True)
class IncidentSpec:
    incident_id: str
    fault_type: str
    target: str
    onset_tick: int
    seed: int

    @property
    def route(self) -> list[str]:
        for route in ROUTES.values():
            if self.target in route:
                return route
        raise ValueError(self.target)

    @property
    def downstream(self) -> list[str]:
        """Transitive callers of the target on its route."""
        route = self.route
        return route[: route.index(self.target)]


def suite_specs(seed: int) -> list[IncidentSpec]:
    rng = random.Random(seed)
    specs = []
    for fault in FAULT_TYPES:
        for target in TARGETS:
            n = len(specs) + 1
            specs.append(
                IncidentSpec(
                    incident_id=f"eval-{fault}-{target[:4]}-{n:03}",
                    fault_type=fault,
                    target=target,
                    onset_tick=rng.randint(5, 7),
                    seed=rng.randint(0, 2**31),
                )
            )
    return specs


def build_incident(spec: IncidentSpec) -> dict[str, list[dict]]:
    rng = random.Random(spec.seed)
    jitter = lambda base, pct=0.02: base * (1.0 + rng.uniform(-pct, pct))
    base_ns = SUITE_BASE_NS + spec.seed % 1000 * TICK * 1000

    metrics: list[dict] = []
    spans: list[dict] = []
    logs: list[dict] = []
    changes: list[dict] = []

    onset = spec.onset_tick
    affected = set(spec.downstream)

    for t in range(TICKS):
        et = base_ns + t * TICK
        ramp = max(0, t - onset + 1)
        for svc in SERVICES:
            mem, cpu, lat, err = 0.35, 0.30, 40.0, 0.0
            is_target = svc == spec.target
            is_affected = svc in affected and t >= onset + 2
            if is_target and t >= onset:
                if spec.fault_type == "mem":
                    mem = 0.35 + ramp * 0.08
                    lat = 40.0 + ramp * 25.0
                elif spec.fault_type == "cpu":
                    cpu = 0.30 + ramp * 0.09
                    lat = 40.0 + ramp * 20.0
                elif spec.fault_type == "latency":
                    lat = 40.0 + ramp * 35.0
                elif spec.fault_type == "error":
                    err = min(0.6, ramp * 0.08)
                    lat = 40.0 + ramp * 10.0
            if is_affected:
                lat = max(lat, 40.0 + (t - onset - 1) * 15.0)
                err = max(err, min(0.2, (t - onset - 1) * 0.02))
            for name, kind, value, unit in [
                ("mem", "gauge", jitter(mem), "ratio"),
                ("cpu", "gauge", jitter(cpu), "ratio"),
                ("latency", "gauge", jitter(lat), "ms"),
                ("error_rate", "gauge", jitter(err) if err else 0.0, "ratio"),
            ]:
                metrics.append(
                    {
                        "event_id": f"m-{svc}-{t}-{name}",
                        "event_time_ns": et,
                        "service": svc,
                        "name": f"{svc}_{name}",
                        "kind": kind,
                        "value": round(value, 6),
                        "unit": unit,
                    }
                )

        # Traces on both routes each tick.
        for route_name, route in ROUTES.items():
            for i in range(2):
                tid = f"tr-{spec.incident_id}-{route_name}-{t}-{i}"
                target_on_route = spec.target in route
                failed = (
                    target_on_route
                    and t >= onset + 2
                    and (i == 0 or spec.fault_type == "error")
                )
                status = "error" if failed else "ok"
                parent = None
                offset = 0
                for depth, svc in enumerate(route):
                    dur = 6_000_000 + depth * 2_000_000
                    if svc == spec.target and t >= onset:
                        dur += ramp * 4_000_000
                    elif svc in affected and t >= onset + 2:
                        dur += (t - onset - 1) * 2_000_000
                    span_id = f"{tid}-{depth}"
                    spans.append(
                        {
                            "event_id": f"s-{tid}-{depth}",
                            "event_time_ns": et + offset,
                            "service": svc,
                            "trace_id": tid,
                            "span_id": span_id,
                            "parent_span_id": parent,
                            "operation": f"op-{route_name}-{depth}",
                            "start_time_ns": et + offset,
                            "end_time_ns": et + offset + dur,
                            "duration_ns": dur,
                            "status": status,
                            "peer_service": route[depth + 1] if depth + 1 < len(route) else None,
                            "span_kind": "server",
                        }
                    )
                    parent = span_id
                    offset += 1_000_000

        if t == onset:
            changes.append(
                {
                    "event_id": f"c-{spec.incident_id}",
                    "event_time_ns": et,
                    "service": spec.target,
                    "change_id": f"deploy-{spec.target[:4]}-{spec.incident_id[-3:]}",
                    "change_type": "deployment",
                    "version_before": "v1",
                    "version_after": "v2",
                }
            )
        if t == onset + 3:
            logs.append(
                {
                    "event_id": f"l-{spec.incident_id}",
                    "event_time_ns": et,
                    "service": spec.target,
                    "severity_text": "ERROR",
                    "body": f"{spec.fault_type} fault symptom on {spec.target}",
                    "trace_id": None,
                    "span_id": None,
                }
            )

    return {
        "metrics": metrics,
        "spans": spans,
        "logs": logs,
        "changes": changes,
        "_base_ns": base_ns,  # popped before writing
    }


def generate_incident(out_root: Path, spec: IncidentSpec) -> Path:
    incident_dir = out_root / DATASET_ID / DATASET_VERSION / spec.incident_id
    incident_dir.mkdir(parents=True, exist_ok=True)
    rows = build_incident(spec)
    base_ns = rows.pop("_base_ns")
    files = []
    counts = {}
    for signal, data in rows.items():
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
        "incident_id": spec.incident_id,
        "system": "online-boutique-synthetic",
        "start_time_ns": base_ns,
        "end_time_ns": base_ns + (TICKS - 1) * TICK,
        "signals": list(rows.keys()),
        "event_counts": counts,
        "files": files,
    }
    labels = {
        "incident_id": spec.incident_id,
        "root_cause_services": [spec.target],
        "root_cause_indicators": [f"{spec.target}_{'latency' if spec.fault_type == 'latency' else spec.fault_type if spec.fault_type != 'error' else 'error_rate'}"],
        "fault_type": spec.fault_type,
        "fault_start_time_ns": base_ns + spec.onset_tick * TICK,
        "fault_end_time_ns": base_ns + (TICKS - 1) * TICK,
        "expected_downstream_services": spec.downstream,
        "notes": f"Synthetic {spec.fault_type} fault on {spec.target} (evaluation suite, seed {spec.seed}).",
    }
    (incident_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (incident_dir / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    validate_incident_dir(incident_dir)
    return incident_dir


def generate_suite(out_root: Path, seed: int) -> list[Path]:
    return [generate_incident(out_root, spec) for spec in suite_specs(seed)]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "datasets" / "fixtures",
    )
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    paths = generate_suite(args.out, args.seed)
    print(f"wrote {len(paths)} incidents under {args.out}")
    for p in paths:
        print(f"  {p.name}")
