# Faultline

Interactive Incident Replay and Root-Cause Visualization.

GitHub: https://github.com/AnushSonone/faultline

## Quick start

```bash
# Rust backend health check
cargo run -p faultlined
# GET http://127.0.0.1:8080/api/v1/health

# Web (separate terminal)
cd web && npm install && npm run dev
```

Windows demo helper: `pwsh -File scripts/run-demo.ps1`

## Spec

See `Faultline_Agent_Project_Specification.txt` for the agent implementation contract.
