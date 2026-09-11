# RCA evaluation (15 incidents, rcaeval-re2-ob/v2 (REAL RCAEval data))

Detector: legacy detector (2026-08-03 configuration), spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2`, commit `021083785736d50937d2a896319583f7cb67b240` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `0191508ba9c4`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.267 |
| top-3 accuracy | 0.467 |
| MRR | 0.407 |
| Avg@5 | 0.413 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.200 | 0.200 | 0.281 | 0.200 | 5 |
| delay | 0.200 | 0.600 | 0.405 | 0.480 | 5 |
| mem | 0.400 | 0.600 | 0.536 | 0.560 | 5 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.267 | 0.467 | 0.407 | 0.413 |
| no_critical_path | 0.267 | 0.467 | 0.407 | 0.413 |
| no_failed_trace_coverage | 0.267 | 0.467 | 0.407 | 0.413 |
| no_log_evidence | 0.267 | 0.467 | 0.407 | 0.413 |
| no_temporal_precedence | 0.133 | 0.400 | 0.320 | 0.347 |
| no_topology | 0.067 | 0.400 | 0.291 | 0.347 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-1 | 9 | -715 | -710 | 12 | 12 | no |
| re2ob-checkoutservice-delay-1 | 2 | -715 | -715 | 12 | 12 | tied |
| re2ob-checkoutservice-mem-1 | 1 | -715 | -714 | 12 | 12 | no |
| re2ob-currencyservice-cpu-1 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-delay-1 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-mem-1 | 11 | -715 | -710 | 12 | 12 | no |
| re2ob-emailservice-cpu-1 | 12 | -715 | -709 | 12 | 12 | no |
| re2ob-emailservice-delay-1 | 3 | -715 | -715 | 12 | 12 | tied |
| re2ob-emailservice-mem-1 | 11 | -715 | -712 | 12 | 12 | no |
| re2ob-productcatalogservice-cpu-1 | 8 | -715 | -710 | 12 | 12 | no |
| re2ob-productcatalogservice-delay-1 | 11 | -715 | -707 | 12 | 12 | no |
| re2ob-productcatalogservice-mem-1 | 1 | -714 | -713 | 12 | 12 | no |
| re2ob-recommendationservice-cpu-1 | 12 | -715 | -709 | 12 | 12 | no |
| re2ob-recommendationservice-delay-1 | 10 | -715 | -712 | 12 | 12 | no |
| re2ob-recommendationservice-mem-1 | 2 | -715 | -715 | 12 | 12 | tied |

## Confusion (predicted -> labeled)

- frontend -> checkoutservice
- currencyservice -> checkoutservice
- productcatalogservice -> currencyservice
- currencyservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> emailservice
- currencyservice -> productcatalogservice
- currencyservice -> productcatalogservice
- emailservice -> recommendationservice
- productcatalogservice -> recommendationservice
- currencyservice -> recommendationservice
