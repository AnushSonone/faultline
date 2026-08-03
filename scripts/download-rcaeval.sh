#!/usr/bin/env bash
# Download the pinned RCAEval v2 archive (RE1/RE2/RE3) from Figshare.
# ~4.2 GB. Resumable (curl -C -). See datasets/manifests/rcaeval.yaml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/datasets/raw}"
URL="https://ndownloader.figshare.com/files/60960049"
mkdir -p "$DEST"
echo "downloading RCAEval-v2.zip (~4.2 GB) to $DEST"
curl -L -C - --fail --retry 3 -o "$DEST/RCAEval-v2.zip" "$URL"
echo "sha256:"
shasum -a 256 "$DEST/RCAEval-v2.zip"
