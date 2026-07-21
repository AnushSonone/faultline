from faultline_data.validate import validate_manifest, validate_labels
import pytest


def test_manifest_ok():
    validate_manifest(
        {
            "schema_version": 1,
            "dataset_id": "d",
            "dataset_version": "v1",
            "incident_id": "i",
            "system": "s",
            "start_time_ns": 0,
            "end_time_ns": 1,
            "signals": ["metrics"],
            "event_counts": {"metrics": 1},
            "files": [{"path": "metrics/part.parquet", "sha256": "a" * 64, "rows": 1}],
        }
    )


def test_manifest_bad_checksum():
    with pytest.raises(ValueError):
        validate_manifest(
            {
                "schema_version": 1,
                "dataset_id": "d",
                "dataset_version": "v1",
                "incident_id": "i",
                "system": "s",
                "start_time_ns": 0,
                "end_time_ns": 1,
                "signals": ["metrics"],
                "event_counts": {"metrics": 1},
                "files": [{"path": "x", "sha256": "short", "rows": 1}],
            }
        )


def test_labels_ok():
    validate_labels(
        {
            "root_cause_services": ["recommendationservice"],
            "fault_type": "mem",
            "fault_start_time_ns": 1,
            "fault_end_time_ns": 2,
        }
    )
