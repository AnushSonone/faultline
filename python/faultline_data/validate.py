"""Validate Faultline incident manifests and labels."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MANIFEST_REQUIRED = [
    "schema_version",
    "dataset_id",
    "dataset_version",
    "incident_id",
    "system",
    "start_time_ns",
    "end_time_ns",
    "signals",
    "event_counts",
    "files",
]

LABELS_REQUIRED = [
    "root_cause_services",
    "fault_type",
    "fault_start_time_ns",
    "fault_end_time_ns",
]


def validate_manifest(data: dict[str, Any]) -> None:
    for key in MANIFEST_REQUIRED:
        if key not in data:
            raise ValueError(f"manifest missing {key}")
    if data["start_time_ns"] > data["end_time_ns"]:
        raise ValueError("start_time_ns > end_time_ns")
    if not data["files"]:
        raise ValueError("files empty")
    for f in data["files"]:
        if len(f.get("sha256", "")) != 64:
            raise ValueError(f"bad checksum for {f.get('path')}")


def validate_labels(data: dict[str, Any]) -> None:
    for key in LABELS_REQUIRED:
        if key not in data:
            raise ValueError(f"labels missing {key}")
    if not data["root_cause_services"]:
        raise ValueError("root_cause_services empty")


def validate_incident_dir(path: str | Path) -> tuple[dict, dict]:
    root = Path(path)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    labels = json.loads((root / "labels.json").read_text(encoding="utf-8"))
    validate_manifest(manifest)
    validate_labels(labels)
    return manifest, labels
