"""Shared scorer: Wilson interval, Avg@5, end-to-end scoring, split manifest reader."""

import json
from pathlib import Path

import pytest

from faultline_data.baselines.manifest import parse_simple_yaml, split_cases, subgroups
from faultline_data.score_rankings import (
    avg_at,
    best_rank,
    load_baselines,
    load_faultline,
    render_markdown,
    score_system,
    summarize,
    wilson,
)


def test_wilson_hand_computed() -> None:
    # 4/15: p = 0.26667, z^2 = 3.84146
    # center = (p + z^2/30) / (1 + z^2/15) = 0.39472 / 1.25610 = 0.31424
    # half = z * sqrt(p(1-p)/15 + z^2/900) / 1.25610 = 1.95996 * 0.13155 / 1.25610 = 0.20526
    lo, hi = wilson(4, 15)
    assert lo == pytest.approx(0.1090, abs=5e-4)
    assert hi == pytest.approx(0.5195, abs=5e-4)
    # 0/10: lower bound 0, upper z^2 / (n + z^2) = 3.84146 / 13.84146 = 0.27753
    lo, hi = wilson(0, 10)
    assert lo == 0.0
    assert hi == pytest.approx(0.27753, abs=1e-4)
    # 15/15 mirrors 0/15: lower 15 / (15 + z^2) = 0.79612
    lo, hi = wilson(15, 15)
    assert lo == pytest.approx(0.79612, abs=1e-4)
    assert hi == 1.0
    assert wilson(0, 0) is None


def test_avg_at_5_hand_computed() -> None:
    assert avg_at(1) == 1.0
    assert avg_at(2) == pytest.approx(0.8)
    assert avg_at(5) == pytest.approx(0.2)
    assert avg_at(6) == 0.0
    assert avg_at(None) == 0.0
    # Ranks 1, 2, 6, none: AC@1 = 1/4, AC@2..5 = 2/4, Avg@5 = (0.25 + 4 * 0.5) / 5 = 0.45
    s = summarize([1, 2, 6, None])
    assert s["avg5"] == pytest.approx(0.45)
    assert (s["top1_k"], s["top3_k"], s["top5_k"], s["n"]) == (1, 2, 2, 4)
    assert s["mrr"] == pytest.approx((1 + 0.5 + 1 / 6) / 4)


def test_best_rank() -> None:
    assert best_rank(["a", "b", "c"], ["b"]) == 2
    assert best_rank(["a", "b", "c"], ["c", "b"]) == 2
    assert best_rank(["a"], ["z"]) is None


def _faultline_json(tmp: Path) -> Path:
    incidents = [
        ("re2ob-a-cpu-1", "cpu", ["a", "b", "c"], "a"),
        ("re2ob-b-mem-1", "mem", ["a", "b", "c"], "b"),
        ("re2ob-c-cpu-2", "cpu", ["a", "b"], "c"),
    ]
    ranks = [1, 2, None]
    report = {
        "protocol": {"detector": "legacy"},
        "overall": {
            "incidents": 3,
            "top1_accuracy": 1 / 3,
            "top3_accuracy": 2 / 3,
            "mrr": (1.0 + 0.5 + 0.0) / 3,
            "avg5": (1.0 + 0.8 + 0.0) / 3,
        },
        "incidents": [
            {
                "incident_id": iid,
                "fault_type": fault,
                "eval": {"labeled_services": [label], "ranked_services": ranked, "best_rank": r},
            }
            for (iid, fault, ranked, label), r in zip(incidents, ranks)
        ],
    }
    path = tmp / "tuning-legacy.json"
    path.write_text(json.dumps(report))
    return path


def test_scores_faultline_and_checks_rust_summary(tmp_path: Path) -> None:
    system = load_faultline(_faultline_json(tmp_path))
    groups = {"heldout_h1": ["re2ob-c-cpu-2"], "tuning": ["re2ob-a-cpu-1", "re2ob-b-mem-1"]}
    scored = score_system(system, groups)
    assert scored["system"] == "faultline-legacy"
    assert scored["rust_summary_check"]["all_equal"] is True
    assert scored["per_fault_type"]["cpu"]["n"] == 2
    assert scored["per_subgroup"]["heldout_h1"]["top1_k"] == 0
    assert scored["per_subgroup"]["tuning"]["top3_k"] == 2


def test_rust_mismatch_is_flagged(tmp_path: Path) -> None:
    path = _faultline_json(tmp_path)
    data = json.loads(path.read_text())
    data["overall"]["top1_accuracy"] = 0.5
    path.write_text(json.dumps(data))
    scored = score_system(load_faultline(path), {})
    assert scored["rust_summary_check"]["all_equal"] is False


def test_baselines_and_markdown(tmp_path: Path) -> None:
    base = {
        "protocol": {"note": "receives the injection time"},
        "methods": ["nsigma", "baro"],
        "cases": [
            {
                "incident_id": "re2ob-a-cpu-1",
                "fault_type": "cpu",
                "labeled_services": ["a"],
                "results": {"nsigma": {"ranked_services": ["a", "b"]}, "baro": {"ranked_services": ["b", "a"]}},
            }
        ],
    }
    path = tmp_path / "tuning-baselines.json"
    path.write_text(json.dumps(base))
    systems = load_baselines(path)
    assert [s.name for s in systems] == ["rcaeval-nsigma", "rcaeval-baro"]
    scored = [score_system(s, {}) for s in systems]
    assert scored[0]["overall"]["top1_k"] == 1
    assert scored[1]["overall"]["top1_k"] == 0
    assert scored[1]["overall"]["avg5"] == pytest.approx(0.8)
    md = render_markdown("T", scored)
    assert "injection time" in md
    assert "1/1 = 1.000" in md
    assert "\u2014" not in md


MANIFEST = """\
# comment line
schema_version: 1
invariants:
  total_cases: 90
tuning:
  dataset_path: rcaeval-re2-ob/v2
  selection: instance 1 of cpu/mem/delay (datasets/raw/phase-a.txt)
  count: 2
  cases:
    - id: re2ob-a-cpu-1
      manifest_sha256: aaaa
    - id: re2ob-a-mem-1
      manifest_sha256: bbbb
heldout:
  dataset_path: rcaeval-re2-ob/v2-heldout
  count: 1
  excluded: []
  short_recordings:  # structural only
    - id: re2ob-a-cpu-2
      span_s: 929  # trailing comment
  cases:
    - id: re2ob-a-cpu-2
      manifest_sha256: cccc
subgroups:
  heldout_h1:
    description: same fault types as tuning (cpu/mem/delay), instances 2-3
    count: 1
    ids:
      - re2ob-a-cpu-2
  heldout_h2:
    description: never tuned on
    count: 0
    ids: []
"""


def test_simple_yaml_matches_expected_structure() -> None:
    m = parse_simple_yaml(MANIFEST)
    assert m["schema_version"] == 1
    assert m["invariants"] == {"total_cases": 90}
    assert split_cases(m, "tuning") == [
        {"id": "re2ob-a-cpu-1", "manifest_sha256": "aaaa"},
        {"id": "re2ob-a-mem-1", "manifest_sha256": "bbbb"},
    ]
    assert m["heldout"]["excluded"] == []
    assert m["heldout"]["short_recordings"] == [{"id": "re2ob-a-cpu-2", "span_s": 929}]
    groups = subgroups(m)
    assert groups["heldout_h1"] == ["re2ob-a-cpu-2"]
    assert groups["heldout_h2"] == []
    assert groups["tuning"] == ["re2ob-a-cpu-1", "re2ob-a-mem-1"]


def test_simple_yaml_agrees_with_pyyaml() -> None:
    yaml = pytest.importorskip("yaml")
    assert parse_simple_yaml(MANIFEST) == yaml.safe_load(MANIFEST)
