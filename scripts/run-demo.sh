#!/usr/bin/env bash
# One-command Faultline local demo: faultlined + Vite UI for rec-mem-001.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export FAULTLINE_ADDR="${FAULTLINE_ADDR:-127.0.0.1:8080}"
export FAULTLINE_FIXTURES="${FAULTLINE_FIXTURES:-$ROOT/datasets/fixtures}"
WEB_PORT="${WEB_PORT:-5173}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
API_URL="http://${FAULTLINE_ADDR}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing dependency '$1'" >&2
    echo "hint: install Rust (rustup), Node.js (npm), and curl before running make demo" >&2
    exit 1
  fi
}

port_in_use() {
  local hostport="$1"
  if command -v lsof >/dev/null 2>&1; then
    local port="${hostport##*:}"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

need cargo
need npm
need curl

if [[ ! -d "$FAULTLINE_FIXTURES/synthetic-ob/v1/rec-mem-001" ]]; then
  echo "error: fixture missing at $FAULTLINE_FIXTURES/synthetic-ob/v1/rec-mem-001" >&2
  exit 1
fi

if port_in_use "$FAULTLINE_ADDR"; then
  echo "error: API port already in use: $FAULTLINE_ADDR" >&2
  echo "hint: stop the other process or set FAULTLINE_ADDR=127.0.0.1:18080" >&2
  exit 1
fi
if port_in_use "127.0.0.1:${WEB_PORT}"; then
  echo "error: web port already in use: ${WEB_PORT}" >&2
  echo "hint: stop the other Vite process or set WEB_PORT=5174" >&2
  exit 1
fi

if [[ ! -d "$ROOT/web/node_modules" ]]; then
  echo "Installing web dependencies (npm install)..."
  (cd "$ROOT/web" && npm install)
fi

DAEMON_PID=""
WEB_PID=""
cleanup() {
  local code=$?
  if [[ -n "${WEB_PID}" ]]; then
    kill "${WEB_PID}" 2>/dev/null || true
    wait "${WEB_PID}" 2>/dev/null || true
  fi
  if [[ -n "${DAEMON_PID}" ]]; then
    kill "${DAEMON_PID}" 2>/dev/null || true
    wait "${DAEMON_PID}" 2>/dev/null || true
  fi
  # Best-effort: clear any leftover listeners we started.
  if command -v lsof >/dev/null 2>&1; then
    local api_port="${FAULTLINE_ADDR##*:}"
    for p in $(lsof -t -nP -iTCP:"$api_port" -sTCP:LISTEN 2>/dev/null || true); do
      kill "$p" 2>/dev/null || true
    done
    for p in $(lsof -t -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null || true); do
      kill "$p" 2>/dev/null || true
    done
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "Starting faultlined on ${API_URL}"
echo "  FAULTLINE_FIXTURES=${FAULTLINE_FIXTURES}"
cargo run -p faultlined > /tmp/faultline-demo-api.log 2>&1 &
DAEMON_PID=$!

echo "Waiting for API health..."
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "error: faultlined exited early; see /tmp/faultline-demo-api.log" >&2
    tail -n 40 /tmp/faultline-demo-api.log >&2 || true
    exit 1
  fi
  if curl -sf "${API_URL}/api/v1/health" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
  echo "error: API health check timed out; see /tmp/faultline-demo-api.log" >&2
  tail -n 40 /tmp/faultline-demo-api.log >&2 || true
  exit 1
fi
curl -sf "${API_URL}/api/v1/health" | tee /dev/stderr
echo

# Warm the canonical incident path (UI also loads it on boot).
SID="$(curl -sf -X POST "${API_URL}/api/v1/sessions" | python3 -c 'import sys,json; print(json.load(sys.stdin)["session_id"])')"
LOAD="$(curl -sf -X POST "${API_URL}/api/v1/sessions/${SID}/load" \
  -H 'content-type: application/json' \
  -d '{"incident_id":"rec-mem-001"}')"
echo "Loaded incident rec-mem-001: ${LOAD}"
echo

echo "Starting Vite UI on ${WEB_URL}"
(cd "$ROOT/web" && npm run dev -- --host 127.0.0.1 --port "${WEB_PORT}") > /tmp/faultline-demo-web.log 2>&1 &
WEB_PID=$!

web_ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "error: Vite exited early; see /tmp/faultline-demo-web.log" >&2
    tail -n 40 /tmp/faultline-demo-web.log >&2 || true
    exit 1
  fi
  if curl -sf "${WEB_URL}" >/dev/null; then
    web_ready=1
    break
  fi
  sleep 0.5
done
if [[ "$web_ready" -ne 1 ]]; then
  echo "error: frontend did not become ready; see /tmp/faultline-demo-web.log" >&2
  tail -n 40 /tmp/faultline-demo-web.log >&2 || true
  exit 1
fi

cat <<EOF

Faultline demo is running.

  Frontend: ${WEB_URL}
  API:      ${API_URL}/api/v1/health
  Fixture:  rec-mem-001 (synthetic Online Boutique MEM fault)
  Heatmap:  streaming (default)

Press Ctrl+C to stop API + UI cleanly.
EOF

wait
