#!/usr/bin/env bash
# RCAEval RE2-OB harness: preflight, Faultline evaluate per detector preset,
# RCAEval 1.6.0 baselines (nsigma, BARO), shared scorer, optional replay stability.
# Protocol and claim rules: docs/references/rcaeval-heldout-protocol.md
#
# Usage:
#   scripts/run-rcaeval.sh [--split tuning|heldout] [--detectors "legacy v2 ..."]
#     [--data DIR] [--out DIR] [--no-baselines] [--replay ID,ID] [--replay-detector NAME] [--step-s N]
#
# --data defaults to $FAULTLINE_DATA or <repo>/datasets, holding fixtures/,
# raw/data/ and manifests/rcaeval-re2ob-split.yaml. The held-out split is refused
# unless the freeze preflight passes. Outputs, in --out (default benchmarks/rcaeval):
#   <split>-<detector>.json|.md  <split>-baselines.json  <split>-summary.md|.json
#   <split>-replay-stability-<detector>.json (with --replay)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SPLIT=tuning
DETECTORS="legacy v2 v2-no-floor v2-no-persistence v2-window32"
DATA="${FAULTLINE_DATA:-$ROOT/datasets}"
OUT="$ROOT/benchmarks/rcaeval"
BASELINES=1
REPLAY=""
REPLAY_DETECTOR=legacy
STEP_S=30

while [ $# -gt 0 ]; do
  case "$1" in
    --split) SPLIT="$2"; shift 2 ;;
    --detectors) DETECTORS="$2"; shift 2 ;;
    --data) DATA="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --no-baselines) BASELINES=0; shift ;;
    --replay) REPLAY="$2"; shift 2 ;;
    --replay-detector) REPLAY_DETECTOR="$2"; shift 2 ;;
    --step-s) STEP_S="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$SPLIT" in
  tuning)
    DATASET=rcaeval-re2-ob/v2
    TITLE="RCAEval RE2-OB tuning split T (15 cases, in-sample)" ;;
  heldout)
    DATASET=rcaeval-re2-ob/v2-heldout
    TITLE="RCAEval RE2-OB held-out split H (75 cases)" ;;
  *) echo "--split must be tuning or heldout" >&2; exit 2 ;;
esac

FIXTURES="$DATA/fixtures"
RAW="$DATA/raw/data"
MANIFEST="$DATA/manifests/rcaeval-re2ob-split.yaml"
VENV_PY="$ROOT/python/.venv-baselines/bin/python"
export PYTHONPATH="$ROOT/python${PYTHONPATH:+:$PYTHONPATH}"

echo "== preflight ($SPLIT) =="
if ! python3 -m faultline_data.baselines.preflight \
    --split "$SPLIT" --fixtures "$FIXTURES" --manifest "$MANIFEST" --repo "$ROOT"; then
  echo "run-rcaeval: refusing split '$SPLIT' (preflight failed)" >&2
  exit 1
fi

if [ "$SPLIT" = heldout ] && [ "$BASELINES" -eq 1 ]; then
  if [ ! -x "$VENV_PY" ] || [ ! -d "$RAW" ]; then
    echo "held-out run needs python/.venv-baselines and $RAW (or pass --no-baselines)" >&2
    exit 1
  fi
fi

cli() { cargo run -q --release -p faultline-cli-bin -- "$@"; }

echo "== build =="
cargo build -q --release -p faultline-cli-bin

mkdir -p "$OUT"
FL_JSONS=()
SKIPPED=()
for det in $DETECTORS; do
  echo "== evaluate $SPLIT / $det =="
  rm -f "$OUT/$SPLIT-$det.json" "$OUT/$SPLIT-$det.md"
  err="$(mktemp)"
  if cli evaluate --fixtures "$FIXTURES" --dataset "$DATASET" --prefix re2ob- \
      --detector "$det" --json "$OUT/$SPLIT-$det.json" --markdown "$OUT/$SPLIT-$det.md" \
      > /dev/null 2> "$err"; then
    FL_JSONS+=("$OUT/$SPLIT-$det.json")
    echo "wrote $OUT/$SPLIT-$det.json"
  elif grep -q "preset not available in this build" "$err"; then
    if [ "$SPLIT" = heldout ]; then
      cat "$err" >&2
      echo "held-out run needs every requested preset; aborting" >&2
      exit 1
    fi
    echo "skipped $det: preset not available in this build"
    SKIPPED+=("$det")
  else
    cat "$err" >&2
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
done

BASE_ARGS=()
if [ "$BASELINES" -eq 1 ]; then
  echo "== baselines $SPLIT (RCAEval nsigma, BARO) =="
  CASE_ARGS=()
  if [ -f "$MANIFEST" ]; then
    CASE_ARGS=(--split-manifest "$MANIFEST" --split "$SPLIT")
  elif [ "$SPLIT" = tuning ] && [ -f "$DATA/raw/phase-a.txt" ]; then
    CASE_ARGS=(--cases "$DATA/raw/phase-a.txt")
  fi
  if [ ! -x "$VENV_PY" ]; then
    echo "baselines skipped (python/.venv-baselines missing; see python/baselines-requirements.txt)"
  elif [ ! -d "$RAW" ]; then
    echo "baselines skipped (raw RCAEval cases not present at $RAW)"
  elif [ "${#CASE_ARGS[@]}" -eq 0 ]; then
    echo "baselines skipped (no split manifest or phase-a.txt case list)"
  else
    UNLOCK=()
    [ "$SPLIT" = heldout ] && UNLOCK=(--unlock-heldout)
    "$VENV_PY" -m faultline_data.baselines.rcaeval --raw "$RAW" "${CASE_ARGS[@]}" \
      --methods nsigma,baro --out "$OUT/$SPLIT-baselines.json" ${UNLOCK[@]+"${UNLOCK[@]}"}
    BASE_ARGS=(--baselines "$OUT/$SPLIT-baselines.json")
    if [ "$SPLIT" = tuning ]; then
      # Reconciles the RESULTS.md 2026-08-03 baseline numbers (not RCAEval's protocol).
      "$VENV_PY" -m faultline_data.baselines.rcaeval --raw "$RAW" "${CASE_ARGS[@]}" \
        --methods nsigma,baro --variant results-2026-08-03 \
        --out "$OUT/$SPLIT-baselines-variant-2026-08-03.json"
      BASE_ARGS+=("$OUT/$SPLIT-baselines-variant-2026-08-03.json")
    fi
  fi
fi

echo "== score $SPLIT =="
SCORE_ARGS=(--title "$TITLE" --out-md "$OUT/$SPLIT-summary.md" --out-json "$OUT/$SPLIT-summary.json")
[ -f "$MANIFEST" ] && SCORE_ARGS+=(--split-manifest "$MANIFEST")
[ "${#FL_JSONS[@]}" -gt 0 ] && SCORE_ARGS+=(--faultline "${FL_JSONS[@]}")
python3 -m faultline_data.score_rankings ${BASE_ARGS[@]+"${BASE_ARGS[@]}"} "${SCORE_ARGS[@]}"

if [ -n "$REPLAY" ]; then
  echo "== replay stability $SPLIT / $REPLAY_DETECTOR =="
  cli replay-stability --fixtures "$FIXTURES" --dataset "$DATASET" --incidents "$REPLAY" \
    --detector "$REPLAY_DETECTOR" --step-s "$STEP_S" \
    --json "$OUT/$SPLIT-replay-stability-$REPLAY_DETECTOR.json"
fi

if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo "presets skipped (not in this build): ${SKIPPED[*]}"
fi
echo "done; outputs in $OUT"
