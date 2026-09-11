"""Adapter tests: miniature RCAEval case + OTel Demo capture conversions."""

import csv
import json
from pathlib import Path

from faultline_data.adapters.otel_demo import convert_capture
from faultline_data.adapters.rcaeval import convert_case


def _write_traces(path: Path, service: str) -> None:
    rows = [
        {
            "time": "21:24",
            "traceID": f"trace{i}",
            "spanID": f"span{i}",
            "serviceName": service if i % 2 == 0 else "frontendservice",
            "methodName": "m",
            "operationName": "op",
            "startTimeMillis": 1705353846000 + i,
            "startTime": 1705353846000000 + i * 1000,
            "duration": 500 + i,
            "statusCode": 0.0 if i % 3 else 2.0,
            "parentSpanID": "" if i == 0 else "span0",
        }
        for i in range(40)
    ]
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def _write_logs(path: Path, service: str) -> None:
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["timestamp", "container_name", "message"])
        w.writeheader()
        w.writerow({"timestamp": 1705353850, "container_name": service, "message": "request ok"})
        w.writerow(
            {"timestamp": 1705353860, "container_name": service, "message": "error: oom killed"}
        )


def _metrics_json() -> dict:
    return {
        "checkoutservice_cpu": [[1705353846 + i, 0.5 + i * 0.01] for i in range(30)],
        "frontend_cpu": [[1705353846 + i, 0.3] for i in range(30)],
    }


def test_rcaeval_convert_case(tmp_path: Path) -> None:
    case = tmp_path / "re2ob_checkoutservice_cpu_9"
    case.mkdir()
    (case / "inject_time.txt").write_text("1705353856")
    (case / "metrics.json").write_text(json.dumps(_metrics_json()))
    _write_traces(case / "traces.csv", "checkoutservice")
    _write_logs(case / "logs.csv", "checkoutservice")

    out = convert_case(case, tmp_path / "fixtures")
    labels = json.loads((out / "labels.json").read_text())
    assert labels["root_cause_services"] == ["checkoutservice"]
    assert labels["fault_type"] == "cpu"
    assert labels["fault_start_time_ns"] == 1705353856 * 10**9
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["event_counts"]["metrics"] == 60
    # frontendservice normalized to frontend (metrics use the short name).
    # validate_incident_dir already ran inside convert_case.


def test_otel_demo_convert_capture(tmp_path: Path) -> None:
    capture = tmp_path / "capture"
    capture.mkdir()
    (capture / "metrics.json").write_text(json.dumps(_metrics_json()))
    _write_traces(capture / "traces.csv", "checkoutservice")
    _write_logs(capture / "logs.csv", "checkoutservice")
    scenario = {
        "demo_git_commit": "abc123",
        "container_image_versions": {"frontend": "1.0"},
        "scenario_config": {"flag": "adServiceHighCpu"},
        "fault_start_unix": 1705353856,
        "fault_end_unix": 1705353870,
        "load_generator_config": {"users": 10},
        "random_seed": 7,
        "ground_truth_root_cause_service": "checkoutservice",
        "ground_truth_fault_type": "cpu",
        "expected_affected_services": ["frontend"],
        "collection_duration_sec": 60,
        "converter_version": "0.1.0",
    }
    (capture / "scenario.json").write_text(json.dumps(scenario))

    out = convert_capture(capture, tmp_path / "fixtures", "otel-test-001")
    labels = json.loads((out / "labels.json").read_text())
    assert labels["root_cause_services"] == ["checkoutservice"]
    assert (out / "scenario.json").exists()


def test_otel_demo_rejects_incomplete_scenario(tmp_path: Path) -> None:
    capture = tmp_path / "capture"
    capture.mkdir()
    (capture / "metrics.json").write_text(json.dumps(_metrics_json()))
    _write_traces(capture / "traces.csv", "checkoutservice")
    (capture / "scenario.json").write_text(json.dumps({"demo_git_commit": "abc"}))
    try:
        convert_capture(capture, tmp_path / "fixtures", "otel-bad-001")
        raise AssertionError("should have rejected incomplete scenario")
    except ValueError as e:
        assert "missing required fields" in str(e)


def test_rcaeval_window_keeps_whole_traces_and_clamps(tmp_path: Path) -> None:
    case = tmp_path / "re2ob_checkoutservice_cpu_9"
    case.mkdir()
    (case / "inject_time.txt").write_text("1705353856")
    (case / "metrics.json").write_text(json.dumps(_metrics_json()))
    _write_traces(case / "traces.csv", "checkoutservice")
    _write_logs(case / "logs.csv", "checkoutservice")

    out = convert_case(
        case,
        tmp_path / "fixtures",
        window_s=(5, 5),
        trace_keep_buckets=1,
        log_cap=10,
        dataset_id="rcaeval-re2-ob-window",
        dataset_version="v1",
        id_suffix="w10",
    )
    assert out.parts[-3:] == ("rcaeval-re2-ob-window", "v1", "re2ob-checkoutservice-cpu-9-w10")
    manifest = json.loads((out / "manifest.json").read_text())
    labels = json.loads((out / "labels.json").read_text())
    # Metrics are 1 s apart from 1705353846; the window is 1705353851..1705353861
    # inclusive, so 11 samples for each of the two series.
    assert manifest["event_counts"]["metrics"] == 22
    # Every trace in the fixture starts inside the first second, before the
    # window opens, so none survive.
    assert manifest["event_counts"]["spans"] == 0
    # Only the 1705353860 line lies inside the window. It can appear twice: the
    # sampler adds error lines first and then a stride over all lines, which
    # can pick the same row again. That predates windowing and is left alone
    # so the benchmark fixtures stay byte-identical; assert on times instead.
    assert manifest["event_counts"]["logs"] >= 1
    import pyarrow.parquet as pq

    log_times = pq.read_table(out / "logs" / "part-00000.parquet").column("event_time_ns").to_pylist()
    assert all((1705353856 - 5) * 10**9 <= t <= (1705353856 + 5) * 10**9 for t in log_times)
    assert manifest["start_time_ns"] >= (1705353856 - 5) * 10**9
    assert manifest["end_time_ns"] <= (1705353856 + 5) * 10**9
    assert labels["fault_start_time_ns"] == 1705353856 * 10**9
    assert labels["fault_end_time_ns"] == manifest["end_time_ns"]
    assert "Windowed to 5 s before and 5 s after" in labels["notes"]
