"""RCAEval 1.6.0 baselines (nsigma, BARO) on RE2-OB, fed the way RCAEval feeds them.

How RCAEval 1.6.0 evaluates one RE2-OB case (`main.py` at tag 1.6.0, `process()`):

1. read the case's metric table (`data.csv` in the Zenodo RE2-OB.zip)
2. drop every column ending in `_latency-50`
3. replace +-inf with NaN, forward fill, then fill what is left with 0
4. `inject_time = int(inject_time.txt) + tdelta` (tdelta defaults to 0)
5. keep the last `length * 60 // 2` rows before inject_time and the first
   `length * 60 // 2` rows at or after it (length defaults to 20, so 600 + 600)
6. rename `*_latency-90` to `*_latency`
7. `sli = "<service>_latency"` when that column exists, else `frontend_1` when
   present, else `frontend_latency`
8. `method(data, inject_time, dataset="re2-ob", anomalies=None,
   dk_select_useful=False, sli=sli, verbose=False, n_iter=num_node, args=...)`
9. coarse-grained scoring: each ranked column maps to
   `column.split("_")[0].replace("-db", "")`, keeping the first occurrence

Both methods then split at inject_time, `preprocess` each side (drop time,
drop constant columns, memory to MB), keep the columns present on both sides,
fit a scaler on the pre-injection side (StandardScaler for nsigma,
RobustScaler for BARO), and rank columns by the maximum post-injection score.

These methods receive the labeled injection time. Faultline does not: it has
to detect the onset itself. Every output file says so.

RCAEval's `main.py` globs `data.csv`, falling back to `simple_metrics.csv`; the
Zenodo RE2-OB.zip ships only `simple_metrics.csv`. Our raw cases come from the
Figshare RCAEval-v2 archive, which stores the metric table as `metrics.json`
(`{"<service>_<metric>": [[unix_s, value], ...]}`). A case directory holding
`data.csv` or `simple_metrics.csv` is read as is; otherwise the table is rebuilt
from `metrics.json` with a leading `time` column and the series in file order.
The output records which source each case used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from faultline_data.baselines.manifest import load_yaml, split_ids

RCAEVAL_VERSION = "1.6.0"
DATASET = "re2-ob"
LENGTH_MIN = 20
TDELTA_S = 0
METHODS = ("nsigma", "baro")
FAULTS = ("cpu", "mem", "disk", "delay", "loss", "socket")
TUNING_FAULTS = ("cpu", "mem", "delay")
INJECTION_NOTE = (
    "nsigma and BARO receive the labeled injection time (inject_time.txt) and compare the "
    f"{LENGTH_MIN * 60 // 2} s before it with the {LENGTH_MIN * 60 // 2} s after it. "
    "Faultline receives no injection time and must detect the onset itself."
)


@dataclass(frozen=True)
class Case:
    service: str
    fault: str
    instance: int

    @property
    def raw_name(self) -> str:
        return f"re2ob_{self.service}_{self.fault}_{self.instance}"

    @property
    def incident_id(self) -> str:
        return f"re2ob-{self.service}-{self.fault}-{self.instance}"

    @property
    def is_tuning(self) -> bool:
        """Tuning split T: instance 1 of cpu/mem/delay (datasets/raw/phase-a.txt)."""
        return self.fault in TUNING_FAULTS and self.instance == 1


def parse_case(name: str) -> Case:
    """Accept `re2ob_svc_fault_1`, `data/re2ob_svc_fault_1`, or `re2ob-svc-fault-1`."""
    n = name.strip().rstrip("/")
    if n.startswith("data/"):
        n = n[len("data/") :]
    parts = n.split("_") if "_" in n else n.split("-")
    if len(parts) != 4 or parts[0] != "re2ob" or parts[2] not in FAULTS:
        raise ValueError(f"not an RE2-OB case name: {name!r}")
    return Case(parts[1], parts[2], int(parts[3]))


def read_case_list(path: Path) -> list[str]:
    names = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            names.append(line)
    return names


def norm_service(name: str, known: set[str]) -> str:
    """Same rule as `adapters/rcaeval.py::_norm_service`: metric service names are
    canonical, and a trailing `service` is dropped when that yields a known name."""
    if name in known:
        return name
    if name.endswith("service") and name[: -len("service")] in known:
        return name[: -len("service")]
    return name


def service_ranks(ranked_columns: list[str]) -> list[str]:
    """RCAEval coarse-grained collapse: column -> service, first occurrence kept."""
    out: list[str] = []
    for col in ranked_columns:
        service = col.split("_")[0].replace("-db", "")
        if service not in out:
            out.append(service)
    return out


def metrics_json_frame(raw: dict[str, list]):
    import pandas as pd

    times = sorted({int(ts) for points in raw.values() for ts, _ in points})
    index = {t: i for i, t in enumerate(times)}
    columns: dict[str, list] = {"time": times}
    for key, points in raw.items():
        col = [math.nan] * len(times)
        for ts, value in points:
            col[index[int(ts)]] = math.nan if value is None else float(value)
        columns[key] = col
    return pd.DataFrame(columns)


def load_metric_table(case_dir: Path):
    """(frame, source file name, sha256 of that file).

    Same lookup order as RCAEval 1.6.0 `main.py`: `data.csv`, then
    `simple_metrics.csv` (what the Zenodo RE2-OB.zip actually ships), then our
    Figshare-archive `metrics.json`."""
    import pandas as pd

    for name in ("data.csv", "simple_metrics.csv"):
        csv_path = case_dir / name
        if csv_path.exists():
            return pd.read_csv(csv_path), name, _sha256(csv_path)
    json_path = case_dir / "metrics.json"
    raw = json.loads(json_path.read_text(encoding="utf-8"))
    return metrics_json_frame(raw), "metrics.json", _sha256(json_path)


VARIANTS = {
    "rcaeval-main": {
        "drop_latency50": True,
        "window": True,
        "description": "RCAEval 1.6.0 main.py process() for RE2-OB (the harness default)",
    },
    "results-2026-08-03": {
        "drop_latency50": False,
        "window": False,
        "description": (
            "reproduces the RESULTS.md 2026-08-03 baseline numbers: full recording, _latency-50 "
            "columns kept. NOT RCAEval's protocol; kept only to reconcile that record."
        ),
    },
}


def prepare_inputs(
    df,
    inject_time: int,
    service: str,
    length_min: int = LENGTH_MIN,
    tdelta: int = TDELTA_S,
    drop_latency50: bool = True,
    window: bool = True,
):
    """Steps 2-7 of RCAEval's `process()`. Returns (data, inject_time, sli, num_node).

    `drop_latency50=False, window=False` is the `results-2026-08-03` variant."""
    import numpy as np
    import pandas as pd

    data = df.loc[:, ~df.columns.str.endswith("_latency-50")] if drop_latency50 else df
    data = data.replace([np.inf, -np.inf], np.nan)
    data = data.ffill()
    data = data.fillna(0)
    inject = int(inject_time) + tdelta
    if window:
        half = length_min * 60 // 2
        normal_df = data[data["time"] < inject].tail(half)
        anomal_df = data[data["time"] >= inject].head(half)
        data = pd.concat([normal_df, anomal_df], ignore_index=True)
    num_node = len(data.columns) - 1
    data = data.rename(
        columns={c: c.replace("_latency-90", "_latency") for c in data.columns if c.endswith("_latency-90")}
    )
    sli = "frontend_latency"
    if f"{service}_latency" in data:
        sli = f"{service}_latency"
    elif "frontend_1" in data:
        sli = "frontend_1"
    return data, inject, sli, num_node


def run_method(method: str, data, inject_time: int, sli: str, num_node: int, data_path: Path) -> list[str]:
    from RCAEval.e2e import baro, nsigma

    func = {"nsigma": nsigma, "baro": baro}[method]
    out = func(
        data.copy(),
        inject_time,
        dataset=DATASET,
        anomalies=None,
        dk_select_useful=False,
        sli=sli,
        verbose=False,
        n_iter=num_node,
        args=argparse.Namespace(root_path=os.getcwd(), data_path=str(data_path)),
    )
    return list(out.get("ranks") or [])


def run_case(raw_root: Path, case: Case, methods: list[str], variant: str = "rcaeval-main") -> dict[str, Any]:
    case_dir = raw_root / case.raw_name
    if not case_dir.is_dir():
        raise FileNotFoundError(f"case directory not found: {case_dir}")
    inject_time = int((case_dir / "inject_time.txt").read_text().strip().splitlines()[0])
    df, source, source_sha = load_metric_table(case_dir)
    v = VARIANTS[variant]
    data, inject, sli, num_node = prepare_inputs(
        df, inject_time, case.service, drop_latency50=v["drop_latency50"], window=v["window"]
    )
    known = {c.split("_", 1)[0] for c in df.columns if c != "time"}
    results = {}
    for method in methods:
        ranked_columns = run_method(method, data, inject, sli, num_node, case_dir / source)
        results[method] = {
            "ranked_services": [norm_service(s, known) for s in service_ranks(ranked_columns)],
            "ranked_metrics": ranked_columns,
        }
    return {
        "case": case.raw_name,
        "incident_id": case.incident_id,
        "fault_type": case.fault,
        "labeled_services": [case.service],
        "inject_time_s": inject_time,
        "input_source": source,
        "input_sha256": source_sha,
        "window_rows": int(len(data)),
        "columns": num_node,
        "sli": sli,
        "results": results,
    }


def resolve_cases(args: argparse.Namespace) -> list[Case]:
    if args.cases:
        names = read_case_list(args.cases)
    else:
        names = split_ids(load_yaml(args.split_manifest), args.split)
        if not names:
            raise SystemExit(f"split '{args.split}' has no cases in {args.split_manifest}")
    cases = [parse_case(n) for n in names]
    heldout_ids: set[str] = set()
    if args.split_manifest:
        heldout_ids = set(split_ids(load_yaml(args.split_manifest), "heldout"))
    locked = [c for c in cases if not c.is_tuning or c.incident_id in heldout_ids]
    if locked and not args.unlock_heldout:
        shown = ", ".join(c.incident_id for c in locked[:5])
        raise SystemExit(
            f"refusing {len(locked)} held-out case(s) ({shown}{', ...' if len(locked) > 5 else ''}): "
            "held-out cases run only through scripts/run-rcaeval.sh after the freeze preflight passes"
        )
    return cases


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _versions() -> dict[str, str]:
    out = {"python": platform.python_version()}
    for mod in ("RCAEval", "numpy", "pandas", "sklearn"):
        try:
            m = __import__(mod)
            out[mod] = getattr(m, "__version__", "unknown")
        except ImportError:
            out[mod] = "missing"
    if out.get("RCAEval") in ("unknown", "missing"):
        try:
            from importlib.metadata import version

            out["RCAEval"] = version("RCAEval")
        except Exception:
            pass
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--raw", type=Path, required=True, help="directory holding re2ob_* case dirs")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--cases", type=Path, help="file with one case name per line")
    src.add_argument("--split-manifest", type=Path, help="rcaeval-re2ob-split.yaml")
    ap.add_argument("--split", choices=("tuning", "heldout"), help="split name with --split-manifest")
    ap.add_argument("--methods", default="nsigma,baro")
    ap.add_argument(
        "--variant",
        choices=tuple(VARIANTS),
        default="rcaeval-main",
        help="input preparation; only rcaeval-main is RCAEval's protocol",
    )
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument(
        "--unlock-heldout",
        action="store_true",
        help="set only by scripts/run-rcaeval.sh after the held-out freeze preflight passes",
    )
    args = ap.parse_args(argv)
    if args.split_manifest and not args.split:
        ap.error("--split-manifest needs --split")
    methods = [m.strip() for m in args.methods.split(",") if m.strip()]
    bad = [m for m in methods if m not in METHODS]
    if bad:
        ap.error(f"unsupported methods {bad}; supported: {', '.join(METHODS)}")

    cases = resolve_cases(args)
    versions = _versions()
    if versions.get("RCAEval") != RCAEVAL_VERSION:
        print(f"warning: RCAEval {versions.get('RCAEval')} installed, protocol pins {RCAEVAL_VERSION}", file=sys.stderr)
    rows = []
    for case in cases:
        print(f"{case.raw_name}: {', '.join(methods)}", file=sys.stderr)
        rows.append(run_case(args.raw, case, methods, args.variant))

    report = {
        "tool": "faultline_data.baselines.rcaeval",
        "protocol": {
            "variant": args.variant,
            "variant_description": VARIANTS[args.variant]["description"],
            "rcaeval_version_pinned": RCAEVAL_VERSION,
            "versions": versions,
            "dataset": DATASET,
            "length_min": LENGTH_MIN,
            "tdelta_s": TDELTA_S,
            "scoring": "coarse-grained service ranking, column.split('_')[0].replace('-db', ''), first occurrence kept",
            "receives_injection_time": True,
            "note": INJECTION_NOTE,
            "input_sources": sorted({r["input_source"] for r in rows}),
            "split": args.split,
        },
        "methods": methods,
        "cases": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
