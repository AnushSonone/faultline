"""Read `datasets/manifests/rcaeval-re2ob-split.yaml` without a hard PyYAML dependency.

PyYAML is used when importable. Otherwise a small parser handles the subset
the split manifest uses: nested mappings, block lists of scalars, block lists
of mappings (`- id: x` followed by indented keys), `[]`, booleans, integers,
and `#` comments.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

SPLITS = {"tuning": "rcaeval-re2-ob/v2", "heldout": "rcaeval-re2-ob/v2-heldout"}
SUBGROUPS = ("heldout_h1", "heldout_h2")


def load_yaml(path: Path) -> Any:
    text = Path(path).read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        return parse_simple_yaml(text)
    return yaml.safe_load(text)


def _strip_comment(line: str) -> str:
    out, quote = [], None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(token: str) -> Any:
    t = token.strip()
    if t in ("", "~", "null"):
        return None
    if t == "[]":
        return []
    if t == "{}":
        return {}
    if t in ("true", "True"):
        return True
    if t in ("false", "False"):
        return False
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "'\"":
        return t[1:-1]
    if re.fullmatch(r"-?(0|[1-9][0-9]*)", t):
        return int(t)
    return t


def parse_simple_yaml(text: str) -> Any:
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        stripped = _strip_comment(raw)
        if not stripped.strip():
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        content = stripped.strip()
        # "- key: value" becomes "-" plus "key: value" one level deeper.
        if content.startswith("- ") and re.match(r"^- [^'\"\[{]*?:( |$)", content):
            lines.append((indent, "-"))
            lines.append((indent + 2, content[2:].strip()))
        else:
            lines.append((indent, content))
    if not lines:
        return None
    value, _ = _parse_block(lines, 0, lines[0][0])
    return value


def _parse_block(lines: list[tuple[int, str]], i: int, indent: int) -> tuple[Any, int]:
    if lines[i][1] == "-" or lines[i][1].startswith("- "):
        items: list[Any] = []
        while i < len(lines) and lines[i][0] == indent and (
            lines[i][1] == "-" or lines[i][1].startswith("- ")
        ):
            content = lines[i][1]
            i += 1
            if content == "-":
                if i < len(lines) and lines[i][0] > indent:
                    child, i = _parse_block(lines, i, lines[i][0])
                    items.append(child)
                else:
                    items.append(None)
            else:
                items.append(_scalar(content[2:]))
        return items, i
    mapping: dict[str, Any] = {}
    while i < len(lines) and lines[i][0] == indent:
        content = lines[i][1]
        if ":" not in content or content.startswith("- "):
            raise ValueError(f"unsupported YAML line: {content!r}")
        key, _, rest = content.partition(":")
        key = key.strip()
        i += 1
        if rest.strip():
            mapping[key] = _scalar(rest)
        elif i < len(lines) and (
            lines[i][0] > indent
            or (lines[i][0] == indent and (lines[i][1] == "-" or lines[i][1].startswith("- ")))
        ):
            mapping[key], i = _parse_block(lines, i, lines[i][0])
        else:
            mapping[key] = None
    return mapping, i


def split_cases(manifest: dict, split: str) -> list[dict]:
    """[{"id": ..., "manifest_sha256": ...}, ...] for `tuning` or `heldout`."""
    section = manifest.get(split) or {}
    return [
        {"id": str(c["id"]), "manifest_sha256": str(c.get("manifest_sha256", ""))}
        for c in (section.get("cases") or [])
    ]


def split_ids(manifest: dict, split: str) -> list[str]:
    return [c["id"] for c in split_cases(manifest, split)]


def subgroups(manifest: dict) -> dict[str, list[str]]:
    """Named case groups: tuning, heldout, and every `subgroups.<name>.ids`."""
    groups: dict[str, list[str]] = {}
    for split in SPLITS:
        ids = split_ids(manifest, split)
        if ids:
            groups[split] = ids
    for name, body in (manifest.get("subgroups") or {}).items():
        ids = (body or {}).get("ids") or []
        groups[str(name)] = [str(x) for x in ids]
    return groups
