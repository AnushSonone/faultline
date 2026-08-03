#!/usr/bin/env bash
# Build the self-contained blog embed bundle and copy it into the wiki.
# Does NOT run the wiki's npm scripts and does NOT touch git.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
DIST_DIR="$WEB_DIR/dist-embed"
DEST_DIR="$REPO_ROOT/../anush-wiki/src/blog/faultline-demo"

cd "$WEB_DIR"
npx vite build --config vite.embed.config.ts

mkdir -p "$DEST_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$DIST_DIR/" "$DEST_DIR/"
else
  rm -rf "$DEST_DIR"
  mkdir -p "$DEST_DIR"
  cp -R "$DIST_DIR/." "$DEST_DIR/"
fi

echo "Embed assets produced:"
(cd "$DIST_DIR" && find . -type f | sort)
echo "Copied to: $DEST_DIR"
