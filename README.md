# Faultline

Interactive Incident Replay and Root-Cause Visualization.

GitHub: https://github.com/AnushSonone/faultline

## Quick start (M2 demo)

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

Or: `pwsh -File scripts/run-demo.ps1`

### Demo checklist

1. UI loads incident `rec-mem-001` (synthetic Online Boutique MEM fault)
2. Press **Play** — topology/heatmap update as event time advances
3. **Pause**, scrub the timeline, select a service on the map or heatmap
4. Select a trace — waterfall renders real spans
5. Selection bar shows linked time / service / trace

## Data

- Canonical fixture: `datasets/fixtures/synthetic-ob/v1/rec-mem-001`
- Regenerate: `cd python && pip install -e . && python -m faultline_data.generate_fixture`
- RCAEval audit: `docs/references/rcaeval-audit.md` (RE2-OB go-with-fallback)

## Spec

See `Faultline_Agent_Project_Specification.txt` for the full agent contract.
M3+ (operators, RCA, SQL) is intentionally not started until M2 is green.
