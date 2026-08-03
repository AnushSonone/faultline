#!/usr/bin/env bash
# Reproduce every RESULTS.md number (TA-048..051) and stamp integrity fields.
# Frontend suite additionally needs the demo stack: `make demo` first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p benchmarks

echo "== integrity =="
{
  echo "git_commit: $(git rev-parse HEAD)"
  echo "git_dirty: $(git status --porcelain | wc -l | tr -d ' ') files"
  echo "date_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "os: $(uname -srm)"
  echo "rustc: $(rustc --version)"
  echo "node: $(node --version)"
  echo "python: $(python3 --version)"
  echo "machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown), $(sysctl -n hw.memsize 2>/dev/null | awk '{print $1/1073741824 " GB"}' || echo '?')"
  echo "eval_suite_seed: 7"
  echo "fixture_manifest_sha256: $(shasum -a 256 datasets/fixtures/synthetic-ob/v1/rec-mem-001/manifest.json | cut -d' ' -f1)"
} | tee benchmarks/integrity.txt

echo "== evaluation suite (TA-048) =="
cargo run -q --release -p faultline-cli-bin -- evaluate \
  --fixtures datasets/fixtures --prefix eval- \
  --json benchmarks/rca-eval.json --markdown benchmarks/rca-eval.md > /dev/null

echo "== engine benchmarks (TA-049) =="
cargo run -q --release -p faultline-cli-bin -- bench-engine \
  --rows 200000 --runs 5 --json benchmarks/engine-bench.json > /dev/null

echo "== recovery benchmark (TA-050) =="
cargo run -q --release -p faultline-cli-bin -- bench-recovery \
  --iterations 20 --json benchmarks/recovery-bench.json > /dev/null

echo "== frontend suite (TA-051, needs make demo running) =="
if curl -sf -o /dev/null http://127.0.0.1:5173; then
  (cd web && npx playwright test -c playwright.perf.config.ts) || true
else
  echo "demo stack not running; skipped frontend suite"
fi

echo "done; raw outputs in benchmarks/"
