#!/usr/bin/env bash
# Extract selected RCAEval v2 case directories from the pinned archive.
#
# The archive (datasets/raw/RCAEval-v2.zip) is a gzip tar despite its name, with
# every case under data/<case>/. This pulls only the requested cases into
# datasets/raw/data/<case>/, skips cases already present and complete, and
# checks that each case has the four files the converter reads.
#
# Usage:
#   scripts/extract-rcaeval.sh [--archive PATH] [--dest DIR] [--verify-sha] \
#     (--list FILE | CASE...)
#
# Case names may carry a data/ prefix (as in datasets/raw/phase-a.txt).
# Idempotent: a second run with the same cases extracts nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$ROOT/datasets/raw/RCAEval-v2.zip"
DEST="$ROOT/datasets/raw"
VERIFY_SHA=0
REQUIRED=(metrics.json traces.csv logs.csv inject_time.txt)
CASES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --verify-sha) VERIFY_SHA=1; shift ;;
    --list)
      while IFS= read -r line || [ -n "$line" ]; do
        line="${line%%#*}"
        line="$(printf '%s' "$line" | tr -d '[:space:]')"
        [ -n "$line" ] && CASES+=("$line")
      done < "$2"
      shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) CASES+=("$1"); shift ;;
  esac
done

if [ "${#CASES[@]}" -eq 0 ]; then
  echo "no cases given (use --list FILE or CASE...)" >&2
  exit 2
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "archive not found: $ARCHIVE (run scripts/download-rcaeval.sh)" >&2
  exit 2
fi

if [ "$VERIFY_SHA" -eq 1 ]; then
  want="$(awk '/^archive_sha256:/ {print $2}' "$ROOT/datasets/manifests/rcaeval.yaml")"
  got="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  if [ "$want" != "$got" ]; then
    echo "archive sha256 mismatch: want $want got $got" >&2
    exit 1
  fi
  echo "archive sha256 ok: $got"
fi

complete() {
  local dir="$DEST/data/$1" f
  [ -d "$dir" ] || return 1
  for f in "${REQUIRED[@]}"; do
    [ -f "$dir/$f" ] || return 1
  done
}

pending=()
skipped=0
for raw in "${CASES[@]}"; do
  name="${raw#data/}"
  name="${name%/}"
  if complete "$name"; then
    skipped=$((skipped + 1))
  else
    pending+=("data/$name")
  fi
done

echo "cases: ${#CASES[@]}  already present: $skipped  to extract: ${#pending[@]}"
if [ "${#pending[@]}" -gt 0 ]; then
  mkdir -p "$DEST"
  # One pass over the archive; bsdtar and GNU tar both fail on a missing member.
  tar -xzf "$ARCHIVE" -C "$DEST" "${pending[@]}"
fi

missing=0
for raw in "${CASES[@]}"; do
  name="${raw#data/}"
  name="${name%/}"
  for f in "${REQUIRED[@]}"; do
    if [ ! -f "$DEST/data/$name/$f" ]; then
      echo "MISSING $name/$f" >&2
      missing=$((missing + 1))
    fi
  done
done

if [ "$missing" -gt 0 ]; then
  echo "$missing required file(s) missing" >&2
  exit 1
fi
echo "all ${#CASES[@]} cases complete under $DEST/data"
