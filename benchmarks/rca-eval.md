# RCA evaluation (16 incidents, synthetic-ob/v1 (synthetic; NOT RCAEval))

Untuned spec 18.4 weights (train-free):

| metric | value |
|---|---|
| top-1 accuracy | 1.000 |
| top-3 accuracy | 1.000 |
| MRR | 1.000 |

## Per fault type

| fault | top-1 | top-3 | MRR | n |
|---|---|---|---|---|
| cpu | 1.000 | 1.000 | 1.000 | 4 |
| error | 1.000 | 1.000 | 1.000 | 4 |
| latency | 1.000 | 1.000 | 1.000 | 4 |
| mem | 1.000 | 1.000 | 1.000 | 4 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR |
|---|---|---|---|
| no_change_proximity | 1.000 | 1.000 | 1.000 |
| no_critical_path | 1.000 | 1.000 | 1.000 |
| no_failed_trace_coverage | 1.000 | 1.000 | 1.000 |
| no_log_evidence | 1.000 | 1.000 | 1.000 |
| no_temporal_precedence | 1.000 | 1.000 | 1.000 |
| no_topology | 1.000 | 1.000 | 1.000 |
