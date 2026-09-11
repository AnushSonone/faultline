"""run-rcaeval preflight: fixture counts, manifest sha256, held-out freeze gate.

Uses synthetic fixture trees and throwaway git repos only; never real held-out data.
"""

import hashlib
import subprocess
from pathlib import Path

from faultline_data.baselines.preflight import frozen_commit, run_preflight


def _git(repo: Path, *args: str) -> str:
    out = subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout.strip()


def _fixture(root: Path, dataset: str, iid: str) -> str:
    d = root / dataset / iid
    d.mkdir(parents=True)
    body = f'{{"incident_id": "{iid}"}}'.encode()
    (d / "manifest.json").write_bytes(body)
    return hashlib.sha256(body).hexdigest()


def _tree(tmp: Path, heldout: int = 2) -> tuple[Path, Path, dict]:
    fixtures = tmp / "fixtures"
    shas = {"tuning": {}, "heldout": {}}
    for i in range(15):
        iid = f"re2ob-s{i}-cpu-1"
        shas["tuning"][iid] = _fixture(fixtures, "rcaeval-re2-ob/v2", iid)
    for i in range(heldout):
        iid = f"re2ob-s{i}-disk-1"
        shas["heldout"][iid] = _fixture(fixtures, "rcaeval-re2-ob/v2-heldout", iid)
    manifest = tmp / "split.yaml"
    lines = []
    for split, path in (("tuning", "rcaeval-re2-ob/v2"), ("heldout", "rcaeval-re2-ob/v2-heldout")):
        lines += [f"{split}:", f"  dataset_path: {path}", f"  count: {len(shas[split])}", "  cases:"]
        for iid, sha in shas[split].items():
            lines += [f"    - id: {iid}", f"      manifest_sha256: {sha}"]
    manifest.write_text("\n".join(lines) + "\n")
    return fixtures, manifest, shas


def _repo(tmp: Path, frozen: str | None) -> tuple[Path, Path]:
    repo = tmp / "repo"
    (repo / "crates").mkdir(parents=True)
    (repo / "crates" / "lib.rs").write_text("fn main() {}\n")
    _git(repo, "init", "-q")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "init")
    head = _git(repo, "rev-parse", "HEAD")
    protocol = repo / "protocol.md"
    value = head if frozen == "HEAD" else (frozen or "")
    protocol.write_text(f"# protocol\n\nfrozen_commit: {value}\n")
    return repo, protocol


def _failed(checks) -> list[str]:
    return [c.name for c in checks if not c.ok]


def test_tuning_passes_and_detects_sha_mismatch(tmp_path: Path) -> None:
    fixtures, manifest, shas = _tree(tmp_path)
    repo, protocol = _repo(tmp_path, None)
    assert _failed(run_preflight("tuning", fixtures, manifest, repo, protocol)) == []
    (fixtures / "rcaeval-re2-ob/v2/re2ob-s3-cpu-1/manifest.json").write_text("{}")
    assert "tuning manifest.json sha256 match" in _failed(run_preflight("tuning", fixtures, manifest, repo, protocol))


def test_tuning_without_manifest_is_tolerated_but_count_enforced(tmp_path: Path) -> None:
    fixtures, _, _ = _tree(tmp_path)
    repo, protocol = _repo(tmp_path, None)
    missing = tmp_path / "nope.yaml"
    assert _failed(run_preflight("tuning", fixtures, missing, repo, protocol)) == []
    import shutil

    shutil.rmtree(fixtures / "rcaeval-re2-ob/v2/re2ob-s0-cpu-1")
    assert "tuning split has 15 incidents" in _failed(run_preflight("tuning", fixtures, missing, repo, protocol))
    assert _failed(run_preflight("tuning", tmp_path / "absent", missing, repo, protocol)) == ["fixtures root exists"]


def test_heldout_refused_when_frozen_commit_empty(tmp_path: Path) -> None:
    fixtures, manifest, _ = _tree(tmp_path)
    repo, protocol = _repo(tmp_path, None)
    assert frozen_commit(protocol) == ""
    checks = run_preflight("heldout", fixtures, manifest, repo, protocol)
    assert _failed(checks) == ["frozen_commit recorded"]
    # Freeze failed, so the held-out fixtures were never examined.
    assert not any(c.name.startswith("heldout ") for c in checks)


def test_heldout_passes_after_freeze_and_fails_on_dirty_or_unrelated_head(tmp_path: Path) -> None:
    fixtures, manifest, _ = _tree(tmp_path)
    repo, protocol = _repo(tmp_path, "HEAD")
    assert _failed(run_preflight("heldout", fixtures, manifest, repo, protocol)) == []

    # A descendant commit is fine.
    (repo / "notes.txt").write_text("x")
    _git(repo, "add", "notes.txt")
    _git(repo, "commit", "-q", "-m", "later")
    assert _failed(run_preflight("heldout", fixtures, manifest, repo, protocol)) == []

    # Uncommitted change in crates/ is refused.
    (repo / "crates" / "lib.rs").write_text("fn main() { changed(); }\n")
    assert "no uncommitted changes in crates/ apps/" in _failed(run_preflight("heldout", fixtures, manifest, repo, protocol))
    _git(repo, "checkout", "--", "crates/lib.rs")

    # Untracked file in apps/ is refused.
    (repo / "apps").mkdir()
    (repo / "apps" / "new.rs").write_text("")
    assert "no untracked files in crates/ apps/" in _failed(run_preflight("heldout", fixtures, manifest, repo, protocol))
    (repo / "apps" / "new.rs").unlink()

    # HEAD on a branch that does not contain the frozen commit is refused.
    frozen = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "--orphan", "other")
    _git(repo, "commit", "-q", "-m", "unrelated")
    protocol.write_text(f"frozen_commit: {frozen}\n")
    assert "HEAD is the frozen commit or a descendant" in _failed(run_preflight("heldout", fixtures, manifest, repo, protocol))


def test_heldout_needs_manifest_and_matching_ids(tmp_path: Path) -> None:
    fixtures, manifest, _ = _tree(tmp_path)
    repo, protocol = _repo(tmp_path, "HEAD")
    assert "split manifest" in _failed(run_preflight("heldout", fixtures, tmp_path / "none.yaml", repo, protocol))
    _fixture(fixtures, "rcaeval-re2-ob/v2-heldout", "re2ob-extra-loss-3")
    assert "heldout fixtures equal manifest ids" in _failed(run_preflight("heldout", fixtures, manifest, repo, protocol))
