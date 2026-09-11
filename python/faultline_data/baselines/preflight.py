"""Preflight for scripts/run-rcaeval.sh. Stdlib only.

Every split:
  - the fixtures root exists
  - the tuning split holds exactly 15 incidents
  - when the split manifest exists, the chosen split's fixture ids equal the
    manifest ids and every manifest.json sha256 matches (absent manifest is
    tolerated for tuning only)

Held-out split, checked BEFORE any held-out fixture is opened:
  - docs/references/rcaeval-heldout-protocol.md has a non-empty `frozen_commit:`
  - `git diff --quiet HEAD -- crates apps` passes and crates/apps have no
    untracked files
  - HEAD is the frozen commit or a descendant of it
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from faultline_data.baselines.manifest import SPLITS, load_yaml, split_cases

TUNING_COUNT = 15
PROTOCOL_DOC = Path("docs/references/rcaeval-heldout-protocol.md")
FROZEN_RE = re.compile(r"^frozen_commit:[ \t]*(\S*)[ \t]*$", re.MULTILINE)


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def fixture_ids(split_dir: Path) -> list[str]:
    if not split_dir.is_dir():
        return []
    return sorted(p.name for p in split_dir.iterdir() if (p / "manifest.json").is_file())


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def frozen_commit(protocol_path: Path) -> str | None:
    """The `frozen_commit:` value, "" when the line is present but empty, None when absent."""
    if not protocol_path.is_file():
        return None
    m = FROZEN_RE.search(protocol_path.read_text(encoding="utf-8"))
    return None if m is None else m.group(1)


def freeze_checks(repo: Path, protocol_path: Path) -> list[Check]:
    checks: list[Check] = []
    value = frozen_commit(protocol_path)
    if value is None:
        checks.append(Check("frozen_commit recorded", False, f"no `frozen_commit:` line in {protocol_path}"))
        return checks
    if not re.fullmatch(r"[0-9a-f]{7,40}", value):
        detail = "empty" if value == "" else f"not a commit hash: {value!r}"
        checks.append(Check("frozen_commit recorded", False, f"frozen_commit is {detail} in {protocol_path}"))
        return checks
    resolved = _git(repo, "rev-parse", "--verify", f"{value}^{{commit}}")
    if resolved.returncode != 0:
        checks.append(Check("frozen_commit recorded", False, f"frozen_commit {value} is not a commit in {repo}"))
        return checks
    frozen = resolved.stdout.strip()
    checks.append(Check("frozen_commit recorded", True, frozen))

    diff = _git(repo, "diff", "--quiet", "HEAD", "--", "crates", "apps")
    checks.append(
        Check(
            "no uncommitted changes in crates/ apps/",
            diff.returncode == 0,
            "git diff --quiet HEAD -- crates apps " + ("passed" if diff.returncode == 0 else "failed"),
        )
    )
    untracked = _git(repo, "ls-files", "--others", "--exclude-standard", "--", "crates", "apps")
    names = [l for l in untracked.stdout.splitlines() if l.strip()]
    checks.append(
        Check("no untracked files in crates/ apps/", not names, ", ".join(names[:5]) or "none")
    )
    head = _git(repo, "rev-parse", "HEAD").stdout.strip()
    ancestor = _git(repo, "merge-base", "--is-ancestor", frozen, "HEAD").returncode == 0
    checks.append(
        Check(
            "HEAD is the frozen commit or a descendant",
            ancestor,
            f"HEAD {head[:12]}, frozen {frozen[:12]}",
        )
    )
    return checks


def manifest_checks(split: str, split_dir: Path, manifest_path: Path) -> list[Check]:
    if not manifest_path.is_file():
        if split == "tuning":
            return [Check("split manifest", True, f"absent ({manifest_path}); sha256 check skipped for tuning-only run")]
        return [Check("split manifest", False, f"required for held-out, not found: {manifest_path}")]
    manifest = load_yaml(manifest_path)
    section = manifest.get(split) or {}
    checks: list[Check] = []
    want_path = SPLITS[split]
    got_path = section.get("dataset_path")
    checks.append(Check(f"manifest {split}.dataset_path", got_path == want_path, f"{got_path} (want {want_path})"))
    cases = split_cases(manifest, split)
    want = {c["id"]: c["manifest_sha256"] for c in cases}
    if section.get("count") is not None:
        checks.append(
            Check(f"manifest {split}.count", int(section["count"]) == len(want), f"count {section['count']}, listed {len(want)}")
        )
    have = set(fixture_ids(split_dir))
    missing = sorted(set(want) - have)
    extra = sorted(have - set(want))
    checks.append(
        Check(
            f"{split} fixtures equal manifest ids",
            not missing and not extra,
            f"{len(have)} fixtures, {len(want)} in manifest"
            + (f"; missing {missing[:3]}" if missing else "")
            + (f"; extra {extra[:3]}" if extra else ""),
        )
    )
    mismatched = [
        cid for cid, sha in want.items() if cid in have and sha256_file(split_dir / cid / "manifest.json") != sha
    ]
    checks.append(
        Check(
            f"{split} manifest.json sha256 match",
            not mismatched,
            f"{len(want) - len(mismatched) - len(missing)} of {len(want)} match"
            + (f"; mismatched {mismatched[:3]}" if mismatched else ""),
        )
    )
    return checks


def run_preflight(split: str, fixtures_root: Path, manifest_path: Path, repo: Path, protocol_path: Path) -> list[Check]:
    checks = [Check("fixtures root exists", fixtures_root.is_dir(), str(fixtures_root))]
    if not checks[0].ok:
        return checks
    tuning = fixture_ids(fixtures_root / SPLITS["tuning"])
    checks.append(Check("tuning split has 15 incidents", len(tuning) == TUNING_COUNT, f"{len(tuning)} under {SPLITS['tuning']}"))
    if split == "heldout":
        freeze = freeze_checks(repo, protocol_path)
        checks.extend(freeze)
        if not all(c.ok for c in freeze):
            checks.append(Check("held-out fixtures untouched", True, "freeze checks failed, held-out fixtures not opened"))
            return checks
    split_dir = fixtures_root / SPLITS[split]
    checks.append(Check(f"{split} fixtures directory exists", split_dir.is_dir(), str(split_dir)))
    if split_dir.is_dir():
        checks.extend(manifest_checks(split, split_dir, manifest_path))
    return checks


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="RCAEval harness preflight")
    ap.add_argument("--split", choices=tuple(SPLITS), required=True)
    ap.add_argument("--fixtures", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--repo", type=Path, default=Path("."))
    ap.add_argument("--protocol", type=Path, help="defaults to <repo>/" + str(PROTOCOL_DOC))
    args = ap.parse_args(argv)
    protocol = args.protocol or args.repo / PROTOCOL_DOC
    checks = run_preflight(args.split, args.fixtures, args.manifest, args.repo, protocol)
    for c in checks:
        print(f"{'PASS' if c.ok else 'FAIL'}  {c.name}: {c.detail}")
    failed = [c for c in checks if not c.ok]
    sys.stdout.flush()
    if failed:
        print(f"preflight FAILED for split '{args.split}' ({len(failed)} check(s)); refusing to run", file=sys.stderr)
        return 1
    print(f"preflight passed for split '{args.split}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
