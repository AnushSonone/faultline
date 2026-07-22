# Faultline

Interactive Incident Replay and Root-Cause Visualization.

GitHub: https://github.com/AnushSonone/faultline

## Quick start (M2 demo)

### macOS / Linux

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

## M3 heatmap streaming

- Default heatmap path: **streaming** (watermarks → Arrow batches → tumbling windows).
- Topology, timeline, and traces remain **precomputed** (M2).
- UI toggles: `Heatmap: streaming|precomputed`, `Adversarial on|off`, plus a collapsible runtime inspector.
- APIs: `POST /api/v1/sessions/{id}/projection-mode`, `GET /api/v1/sessions/{id}/runtime`.

## Spec

See `Faultline_Agent_Project_Specification.txt` for the full agent contract.
M3 core covers TA-021…025. Do not start TA-026+ until explicitly requested.
