#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export FAULTLINE_ADDR="${FAULTLINE_ADDR:-127.0.0.1:8080}"

echo "Starting faultlined on http://$FAULTLINE_ADDR"
cargo run -p faultlined &
DAEMON_PID=$!
cleanup() { kill $DAEMON_PID 2>/dev/null || true; }
trap cleanup EXIT

sleep 2
curl -sf "http://$FAULTLINE_ADDR/api/v1/health" | tee /dev/stderr
echo
echo "Skeleton demo ready. Open web with: make web-dev"
echo "Press Ctrl+C to stop."
wait
