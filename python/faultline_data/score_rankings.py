"""Shared scorer for Faultline `evaluate` JSONs and RCAEval baseline JSONs.

One scoring path for every system, so Faultline and the baselines are measured
identically: best rank of a labeled root-cause service in the system's ranked
service list, then top-1, top-3, MRR, and RCAEval's Avg@5, with k/n and Wilson
95% intervals for the proportions, overall, per fault type, and per subgroup
from the split manifest. Stdlib only.

    python -m faultline_data.score_rankings \
      --faultline benchmarks/rcaeval/tuning-legacy.json \
      --baselines benchmarks/rcaeval/tuning-baselines.json \
      --split-manifest datasets/manifests/rcaeval-re2ob-split.yaml \
      --title "RE2-OB tuning split (T, in-sample)" \
      --out-md benchmarks/rcaeval/tuning-summary.md --out-json benchmarks/rcaeval/tuning-summary.json
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from faultline_data.baselines.manifest import load_yaml, subgroups

Z95 = 1.959963984540054  # two-sided 95% normal quantile
BASELINE_NOTE = (
    "nsigma and BARO receive the labeled injection time and compare the window before it with the "
    "window after it. Faultline receives no injection time and detects the onset itself."
)


def best_rank(ranked: list[str], labeled: list[str]) -> int | None:
    for i, service in enumerate(ranked):
        if service in labeled:
            return i + 1
    return None


def hit_at(rank: int | None, k: int) -> bool:
    return rank is not None and rank <= k


def avg_at(rank: int | None, k: int = 5) -> float:
    """Per-case Avg@k: mean over j=1..k of AC@j. Averaged over cases this equals
    RCAEval's `Evaluator.average(k) = sum(AC@j for j in 1..k) / k`."""
    return sum(1 for j in range(1, k + 1) if hit_at(rank, j)) / k


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    """Wilson score interval for k successes in n trials."""
    if n <= 0:
        return None
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def summarize(ranks: list[int | None]) -> dict[str, Any]:
    n = len(ranks)
    out: dict[str, Any] = {"n": n}
    for k in (1, 3, 5):
        hits = sum(1 for r in ranks if hit_at(r, k))
        out[f"top{k}_k"] = hits
        out[f"top{k}"] = hits / n if n else 0.0
        out[f"top{k}_wilson95"] = wilson(hits, n)
    mrr_sum = 0.0
    avg_sum = 0.0
    for r in ranks:
        mrr_sum += 1.0 / r if r is not None else 0.0
        avg_sum += avg_at(r, 5)
    out["mrr"] = mrr_sum / n if n else 0.0
    out["avg5"] = avg_sum / n if n else 0.0
    return out


@dataclass
class System:
    name: str
    kind: str  # "faultline" or "baseline"
    source: str
    cases: dict[str, dict[str, Any]] = field(default_factory=dict)
    rust_overall: dict[str, Any] | None = None
    note: str = ""


def load_faultline(path: Path) -> System:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    detector = (data.get("protocol") or {}).get("detector")
    name = f"faultline-{detector}" if detector else f"faultline ({Path(path).stem})"
    system = System(name=name, kind="faultline", source=Path(path).name)
    system.rust_overall = data.get("overall") or data.get("untuned")
    for inc in data["incidents"]:
        ev = inc["eval"]
        system.cases[inc["incident_id"]] = {
            "fault_type": inc["fault_type"],
            "labeled": ev["labeled_services"],
            "ranked": ev["ranked_services"],
            "best_rank": best_rank(ev["ranked_services"], ev["labeled_services"]),
            "reported_best_rank": ev.get("best_rank"),
        }
    return system


def load_baselines(path: Path) -> list[System]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    protocol = data.get("protocol") or {}
    note = protocol.get("note", BASELINE_NOTE)
    variant = protocol.get("variant", "rcaeval-main")
    suffix = "" if variant == "rcaeval-main" else f" [{variant} variant]"
    systems = []
    for method in data["methods"]:
        s = System(name=f"rcaeval-{method}{suffix}", kind="baseline", source=Path(path).name, note=note)
        for case in data["cases"]:
            ranked = case["results"][method]["ranked_services"]
            s.cases[case["incident_id"]] = {
                "fault_type": case["fault_type"],
                "labeled": case["labeled_services"],
                "ranked": ranked,
                "best_rank": best_rank(ranked, case["labeled_services"]),
            }
        systems.append(s)
    return systems


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-12


def score_system(system: System, groups: dict[str, list[str]]) -> dict[str, Any]:
    ids = list(system.cases)  # file order, same order the Rust summary summed in
    ranks = [system.cases[i]["best_rank"] for i in ids]
    result: dict[str, Any] = {
        "system": system.name,
        "kind": system.kind,
        "source": system.source,
        "overall": summarize(ranks),
        "per_fault_type": {},
        "per_subgroup": {},
        "per_case_best_rank": {i: system.cases[i]["best_rank"] for i in ids},
    }
    faults = sorted({c["fault_type"] for c in system.cases.values()})
    for fault in faults:
        result["per_fault_type"][fault] = summarize(
            [system.cases[i]["best_rank"] for i in ids if system.cases[i]["fault_type"] == fault]
        )
    for name, members in groups.items():
        present = [i for i in ids if i in set(members)]
        if present:
            result["per_subgroup"][name] = summarize([system.cases[i]["best_rank"] for i in present])
    if system.rust_overall is not None:
        o = result["overall"]
        r = system.rust_overall
        checks = {
            "top1": _close(o["top1"], r["top1_accuracy"]),
            "top3": _close(o["top3"], r["top3_accuracy"]),
            "mrr": _close(o["mrr"], r["mrr"]),
            "n": o["n"] == r["incidents"],
        }
        if "avg5" in r:
            checks["avg5"] = _close(o["avg5"], r["avg5"])
        checks["best_rank"] = all(
            c["best_rank"] == c.get("reported_best_rank") for c in system.cases.values()
        )
        result["rust_summary_check"] = {"all_equal": all(checks.values()), **checks}
    return result


def _pct(x: float) -> str:
    return f"{x:.3f}"


def _ci(ci: tuple[float, float] | None) -> str:
    return "-" if ci is None else f"[{ci[0]:.3f}, {ci[1]:.3f}]"


def _row(label: str, s: dict[str, Any]) -> str:
    return (
        f"| {label} | {s['top1_k']}/{s['n']} = {_pct(s['top1'])} {_ci(s['top1_wilson95'])} "
        f"| {s['top3_k']}/{s['n']} = {_pct(s['top3'])} {_ci(s['top3_wilson95'])} "
        f"| {_pct(s['mrr'])} | {_pct(s['avg5'])} |"
    )


HEADER = "| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |\n|---|---|---|---|---|"


def render_markdown(title: str, scored: list[dict[str, Any]]) -> str:
    out = [f"# {title}", ""]
    if any(s["kind"] == "baseline" for s in scored):
        out += [f"Note: {BASELINE_NOTE}", ""]
    out += [
        "Metrics: best rank of the labeled root-cause service in each system's ranked service list. "
        "Avg@5 is RCAEval's mean of AC@1..AC@5. Wilson intervals apply to the proportions only; "
        "MRR and Avg@5 carry no interval here.",
        "",
        "## Overall",
        "",
        HEADER,
    ]
    out += [_row(s["system"], s["overall"]) for s in scored]
    groups = sorted({g for s in scored for g in s["per_subgroup"]})
    for g in groups:
        out += ["", f"## Subgroup {g}", "", HEADER]
        out += [_row(s["system"], s["per_subgroup"][g]) for s in scored if g in s["per_subgroup"]]
    faults = sorted({f for s in scored for f in s["per_fault_type"]})
    for f in faults:
        out += ["", f"## Fault type {f}", "", HEADER]
        out += [_row(s["system"], s["per_fault_type"][f]) for s in scored if f in s["per_fault_type"]]
    checks = [s for s in scored if "rust_summary_check" in s]
    if checks:
        out += ["", "## Scorer versus Rust summary", ""]
        for s in checks:
            c = s["rust_summary_check"]
            verdict = "equal" if c["all_equal"] else "MISMATCH " + json.dumps(c)
            out.append(f"- {s['system']} ({s['source']}): {verdict}")
    ids = sorted({i for s in scored for i in s["per_case_best_rank"]})
    out += ["", "## Best rank per case", "", "| case | " + " | ".join(s["system"] for s in scored) + " |"]
    out.append("|---|" + "---|" * len(scored))
    for i in ids:
        cells = []
        for s in scored:
            r = s["per_case_best_rank"].get(i, "n/a")
            cells.append("-" if r is None else str(r))
        out.append(f"| {i} | " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Score Faultline and baseline rankings")
    ap.add_argument("--faultline", type=Path, nargs="*", default=[])
    ap.add_argument("--baselines", type=Path, nargs="*", default=[])
    ap.add_argument("--split-manifest", type=Path)
    ap.add_argument("--title", default="RCAEval RE2-OB ranking summary")
    ap.add_argument("--out-md", type=Path, required=True)
    ap.add_argument("--out-json", type=Path)
    args = ap.parse_args(argv)

    systems = [load_faultline(p) for p in args.faultline]
    for p in args.baselines:
        systems.extend(load_baselines(p))
    if not systems:
        ap.error("nothing to score")
    groups: dict[str, list[str]] = {}
    if args.split_manifest and args.split_manifest.is_file():
        groups = subgroups(load_yaml(args.split_manifest))
    scored = [score_system(s, groups) for s in systems]
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(render_markdown(args.title, scored), encoding="utf-8")
    if args.out_json:
        args.out_json.write_text(json.dumps({"title": args.title, "systems": scored}, indent=2) + "\n", encoding="utf-8")
    mismatches = [s["system"] for s in scored if not s.get("rust_summary_check", {"all_equal": True})["all_equal"]]
    for s in scored:
        o = s["overall"]
        print(f"{s['system']}: top1 {o['top1_k']}/{o['n']} top3 {o['top3_k']}/{o['n']} mrr {o['mrr']:.4f} avg5 {o['avg5']:.4f}")
    if mismatches:
        print(f"scorer disagrees with Rust summary for: {', '.join(mismatches)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
