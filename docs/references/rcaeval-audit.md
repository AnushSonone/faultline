# RCAEval source audit (TA-004)

**Date:** 2026-07-21  
**Decision:** **GO with fallback** for M2 vertical slice.

## Summary

| Item | Finding |
|------|---------|
| Repo | https://github.com/phamquiluan/RCAEval |
| License | MIT for datasets + framework (third-party baselines vary; do not vendor) |
| Layout | `{benchmark}_{service}_{fault}_{instance}/` → `metrics.json`, `inject_time.txt`, optional `logs.csv`, `traces.csv` |
| Labels | Encoded in directory name + inject timestamp |
| Best first case | RE2-OB with MEM fault (has metrics+logs+traces) |
| Avoid for waterfall | RE2-SS / RE3-SS (traces N/A) |
| Volume | Full RE2 zip ~4.2GB — blocks quick M2 |

## Timestamp mapping

- `inject_time.txt`: Unix seconds → `fault_start_time_ns = seconds * 1e9`
- Metric/log/trace timestamps: treat as Unix seconds unless audit of a live file shows ms; converter must record unit in manifest attributes

## Go / no-go

- **Real RE2-OB:** GO once a single-case download path is verified (Figshare structured article or scripted one-dir fetch). Not required to unblock M2.
- **M2 path:** Use committed synthetic multi-signal fixture `synthetic-ob/v1/rec-mem-001` through the same Parquet → replay → WS pipeline.

## Fallback

Generator: `python -m faultline_data.generate_fixture`  
Output: `datasets/fixtures/synthetic-ob/v1/rec-mem-001/`

## Follow-ups

- Implement `adapters/rcaeval.py` convert for one RE2-OB directory without downloading full zip
- Measure parent-span completeness on first real case and update this doc
