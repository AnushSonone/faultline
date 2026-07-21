"""RCAEval adapter stub — full conversion after TA-004 go decision."""

from __future__ import annotations

from pathlib import Path


def describe_expected_layout() -> str:
    return (
        "RCAEval case dir: {benchmark}_{service}_{fault}_{instance}/ "
        "with metrics.json, inject_time.txt, optional logs.csv, traces.csv"
    )


def convert_case(_src: Path, _dst: Path) -> None:
    raise NotImplementedError(
        "Use synthetic fixture for M2; implement RE2-OB conversion after audit go"
    )
