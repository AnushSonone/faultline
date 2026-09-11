"""RCAEval baseline runner: case parsing, held-out guard, input preparation, end to end."""

import argparse
import json
import math
from pathlib import Path

import pytest

from faultline_data.baselines.rcaeval import (
    INJECTION_NOTE,
    parse_case,
    resolve_cases,
    service_ranks,
    norm_service,
)


def test_parse_case_forms() -> None:
    for name in ("re2ob_checkoutservice_cpu_1", "data/re2ob_checkoutservice_cpu_1", "re2ob-checkoutservice-cpu-1"):
        c = parse_case(name)
        assert (c.service, c.fault, c.instance) == ("checkoutservice", "cpu", 1)
        assert c.raw_name == "re2ob_checkoutservice_cpu_1"
        assert c.incident_id == "re2ob-checkoutservice-cpu-1"
        assert c.is_tuning
    assert not parse_case("re2ob_emailservice_mem_2").is_tuning
    assert not parse_case("re2ob_emailservice_disk_1").is_tuning
    with pytest.raises(ValueError):
        parse_case("re1ob_x_cpu_1")


def test_service_collapse_matches_rcaeval() -> None:
    ranked = ["cartservice_cpu", "redis_mem", "cartservice_mem", "carts-db_cpu", "frontend-external_error"]
    assert service_ranks(ranked) == ["cartservice", "redis", "carts", "frontend-external"]
    known = {"frontend", "cartservice"}
    assert norm_service("frontendservice", known) == "frontend"
    assert norm_service("cartservice", known) == "cartservice"


def _ns(tmp: Path, names: list[str], unlock: bool = False, manifest: Path | None = None) -> argparse.Namespace:
    cases = tmp / "cases.txt"
    cases.write_text("# header\n" + "\n".join(names) + "\n")
    return argparse.Namespace(
        cases=None if manifest else cases, split_manifest=manifest, split="tuning" if manifest else None,
        unlock_heldout=unlock,
    )


def test_heldout_cases_refused_without_unlock(tmp_path: Path) -> None:
    ok = resolve_cases(_ns(tmp_path, ["data/re2ob_checkoutservice_cpu_1"]))
    assert [c.incident_id for c in ok] == ["re2ob-checkoutservice-cpu-1"]
    with pytest.raises(SystemExit, match="refusing 1 held-out"):
        resolve_cases(_ns(tmp_path, ["re2ob_checkoutservice_cpu_1", "re2ob_checkoutservice_disk_1"]))
    unlocked = resolve_cases(_ns(tmp_path, ["re2ob_checkoutservice_disk_1"], unlock=True))
    assert unlocked[0].fault == "disk"


def test_manifest_heldout_listing_is_refused(tmp_path: Path) -> None:
    # A manifest that (wrongly) puts a structurally tuning-shaped case in heldout still locks it.
    manifest = tmp_path / "split.yaml"
    manifest.write_text(
        "tuning:\n  cases:\n    - id: re2ob-a-cpu-1\n      manifest_sha256: x\n"
        "heldout:\n  cases:\n    - id: re2ob-a-cpu-1\n      manifest_sha256: x\n"
    )
    with pytest.raises(SystemExit, match="held-out"):
        resolve_cases(_ns(tmp_path, [], manifest=manifest))


def _write_case(root: Path, name: str = "re2ob_checkoutservice_cpu_1") -> Path:
    t0, inject = 1_700_000_000, 1_700_000_720
    series = {}
    for svc in ("checkoutservice", "frontend", "cartservice"):
        for metric in ("cpu", "mem", "latency-50", "latency-90"):
            pts = []
            for i in range(1441):
                t = t0 + i
                v = 1.0 + 0.05 * math.sin(i * (0.37 + len(svc) * 0.01)) + 0.02 * math.cos(i * 1.3)
                if svc == "checkoutservice" and metric == "cpu" and t >= inject + 30:
                    v += 5.0
                pts.append([t, v if i != 5 else None])
            series[f"{svc}_{metric}"] = pts
    series["frontend-external_workload"] = [[t0 + i, 3.0 + 0.1 * math.sin(i)] for i in range(1441)]
    case = root / name
    case.mkdir(parents=True)
    (case / "metrics.json").write_text(json.dumps(series))
    (case / "inject_time.txt").write_text(f"{inject}\n")
    return case


def test_prepare_inputs_mirrors_rcaeval_process(tmp_path: Path) -> None:
    pytest.importorskip("pandas")
    from faultline_data.baselines.rcaeval import load_metric_table, prepare_inputs

    case = _write_case(tmp_path)
    df, source, sha = load_metric_table(case)
    assert source == "metrics.json" and len(sha) == 64
    assert list(df.columns)[0] == "time"
    assert df.shape == (1441, 14)
    assert math.isnan(df.loc[5, "checkoutservice_cpu"])
    data, inject, sli, num_node = prepare_inputs(df, 1_700_000_720, "checkoutservice")
    assert inject == 1_700_000_720
    assert len(data) == 1200  # 600 rows before, 600 rows at or after the injection
    assert (data["time"] < inject).sum() == 600
    assert not any(c.endswith("_latency-50") for c in data.columns)
    assert "checkoutservice_latency" in data.columns
    assert sli == "checkoutservice_latency"
    assert num_node == 10  # 13 series minus 3 latency-50, time excluded
    assert not data.isna().any().any()

    # results-2026-08-03 variant: full recording, latency-50 kept.
    full, _, sli_full, num_full = prepare_inputs(
        df, 1_700_000_720, "checkoutservice", drop_latency50=False, window=False
    )
    assert len(full) == 1441
    assert "checkoutservice_latency-50" in full.columns
    assert num_full == 13
    assert sli_full == "checkoutservice_latency"


def test_nsigma_and_baro_end_to_end(tmp_path: Path) -> None:
    pytest.importorskip("RCAEval")
    from faultline_data.baselines.rcaeval import main

    _write_case(tmp_path / "raw")
    cases = tmp_path / "cases.txt"
    cases.write_text("re2ob_checkoutservice_cpu_1\n")
    out = tmp_path / "out.json"
    assert main(["--raw", str(tmp_path / "raw"), "--cases", str(cases), "--out", str(out)]) == 0
    report = json.loads(out.read_text())
    assert report["protocol"]["receives_injection_time"] is True
    assert report["protocol"]["note"] == INJECTION_NOTE
    row = report["cases"][0]
    assert row["incident_id"] == "re2ob-checkoutservice-cpu-1"
    for method in ("nsigma", "baro"):
        assert row["results"][method]["ranked_services"][0] == "checkoutservice"
        assert row["results"][method]["ranked_metrics"][0] == "checkoutservice_cpu"
