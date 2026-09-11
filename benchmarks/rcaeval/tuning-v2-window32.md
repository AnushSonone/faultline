# RCA evaluation (15 incidents, rcaeval-re2-ob/v2 (REAL RCAEval data))

Detector preset: v2-window32, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2`, commit `1e42d2462f51a39dfbb5c800778809e763e3c3d3` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `81d7370bdb8a`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.200 |
| top-3 accuracy | 0.267 |
| MRR | 0.348 |
| Avg@5 | 0.360 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.000 | 0.200 | 0.192 | 0.200 | 5 |
| delay | 0.200 | 0.200 | 0.342 | 0.360 | 5 |
| mem | 0.400 | 0.400 | 0.510 | 0.520 | 5 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.200 | 0.267 | 0.348 | 0.360 |
| no_critical_path | 0.200 | 0.267 | 0.348 | 0.360 |
| no_failed_trace_coverage | 0.200 | 0.267 | 0.348 | 0.360 |
| no_log_evidence | 0.200 | 0.267 | 0.348 | 0.360 |
| no_temporal_precedence | 0.200 | 0.267 | 0.348 | 0.360 |
| no_topology | 0.200 | 0.267 | 0.348 | 0.360 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-1 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-delay-1 | 4 | +719 | - | 1 | 0 | no |
| re2ob-checkoutservice-mem-1 | 1 | +704 | +704 | 1 | 0 | yes |
| re2ob-currencyservice-cpu-1 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-delay-1 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-mem-1 | 4 | - | - | 0 | 0 | no |
| re2ob-emailservice-cpu-1 | 6 | +711 | - | 1 | 0 | no |
| re2ob-emailservice-delay-1 | 1 | +718 | +718 | 1 | 0 | yes |
| re2ob-emailservice-mem-1 | 5 | -380 | - | 1 | 1 | no |
| re2ob-productcatalogservice-cpu-1 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-delay-1 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-mem-1 | 1 | +26 | +26 | 1 | 0 | yes |
| re2ob-recommendationservice-cpu-1 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-delay-1 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-mem-1 | 10 | - | - | 0 | 0 | no |

## Confusion (predicted -> labeled)

- adservice -> checkoutservice
- paymentservice -> checkoutservice
- adservice -> currencyservice
- adservice -> currencyservice
- adservice -> currencyservice
- redis -> emailservice
- adservice -> emailservice
- adservice -> productcatalogservice
- adservice -> productcatalogservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
