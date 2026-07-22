# Faultline

Interactive Incident Replay and Root-Cause Visualization.

GitHub: https://github.com/AnushSonone/faultline

## Quick start (local product review)

```bash
make demo
# Frontend: http://127.0.0.1:5173
# Ctrl+C stops API + UI
```

Requires: Rust (`cargo`), Node.js (`npm`), `curl`. First run installs `web/node_modules` if missing.

### Manual two-terminal start (macOS / Linux)

```bash
# Terminal 1 — API
export FAULTLINE_FIXTURES="$PWD/datasets/fixtures"
cargo run -p faultlined

# Terminal 2 — UI
cd web
npm install
npm run dev
```

### Windows (PowerShell)

```powershell
# Terminal 1 — API
$env:FAULTLINE_FIXTURES = "$PWD\datasets\fixtures"
cargo run -p faultlined

# Terminal 2 — UI
cd web
npm install
npm run dev
```

Open http://127.0.0.1:5173

Helpers: `bash scripts/run-demo.sh` or `pwsh -File scripts/run-demo.ps1`

### Demo checklist

1. UI loads incident `rec-mem-001` (**synthetic** Online Boutique-style MEM fault)
2. Banner shows **fixture ground truth (not inferred)** from labels
3. Press **Play** — topology/heatmap update as event time advances
4. **Pause**, scrub the timeline, select a service on the map or heatmap
5. Select a trace — waterfall renders fixture spans
6. Selection bar shows linked time / service / trace

## Data

- Canonical fixture: `datasets/fixtures/synthetic-ob/v1/rec-mem-001`
- Regenerate: `cd python && python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && python -m faultline_data.generate_fixture`
- RCAEval audit: `docs/references/rcaeval-audit.md` (RE2-OB go-with-fallback)
- M2 audit: `docs/audits/M2_COMPLETION_AUDIT.md`

## M3 streaming runtime

- Default heatmap path: **streaming** (watermarks → Arrow batches → filter → window avg + DDSketch p50/p95/p99).
- Deployment correlation: **streaming left temporal join** (not root-cause inference).
- Topology structure, timeline base events, and traces remain **precomputed** (M2).
- UI: heatmap mode toggle, adversarial replay, deployment correlation panel, polished runtime inspector.
- APIs: `POST /api/v1/sessions/{id}/projection-mode`, `GET /api/v1/sessions/{id}/runtime`.
- Audits: `docs/audits/M3_EVENT_TIME_CORE_AUDIT.md`, `docs/audits/M3_RUNTIME_DEPTH_AUDIT.md`.

## Spec

See `Faultline_Agent_Project_Specification.txt` for the full agent contract.
M3 covers TA-021…029. Do not start M4 root-cause inference until explicitly requested.
