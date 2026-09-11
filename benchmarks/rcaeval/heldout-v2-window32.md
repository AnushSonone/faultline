# RCA evaluation (75 incidents, rcaeval-re2-ob/v2-heldout (REAL RCAEval data))

Detector preset: v2-window32, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2-heldout`, commit `21e7346adc4b52e08deff9d4e1a4326436baa9f9` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `81d7370bdb8a`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.173 |
| top-3 accuracy | 0.387 |
| MRR | 0.354 |
| Avg@5 | 0.403 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.100 | 0.200 | 0.279 | 0.320 | 10 |
| delay | 0.200 | 0.300 | 0.376 | 0.420 | 10 |
| disk | 0.333 | 0.600 | 0.489 | 0.533 | 15 |
| loss | 0.133 | 0.333 | 0.309 | 0.333 | 15 |
| mem | 0.200 | 0.700 | 0.437 | 0.580 | 10 |
| socket | 0.067 | 0.200 | 0.243 | 0.267 | 15 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.173 | 0.387 | 0.354 | 0.403 |
| no_critical_path | 0.187 | 0.387 | 0.363 | 0.408 |
| no_failed_trace_coverage | 0.173 | 0.387 | 0.356 | 0.405 |
| no_log_evidence | 0.173 | 0.387 | 0.354 | 0.403 |
| no_temporal_precedence | 0.147 | 0.387 | 0.338 | 0.395 |
| no_topology | 0.173 | 0.360 | 0.347 | 0.384 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-2 | 4 | +185 | - | 3 | 0 | no |
| re2ob-checkoutservice-cpu-3 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-delay-2 | 4 | +709 | - | 1 | 0 | no |
| re2ob-checkoutservice-delay-3 | 4 | +718 | - | 1 | 0 | no |
| re2ob-checkoutservice-disk-1 | 3 | +707 | - | 1 | 0 | no |
| re2ob-checkoutservice-disk-2 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-disk-3 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-loss-1 | 5 | +708 | - | 1 | 0 | no |
| re2ob-checkoutservice-loss-2 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-loss-3 | 3 | -705 | - | 2 | 2 | no |
| re2ob-checkoutservice-mem-2 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-mem-3 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-socket-1 | 1 | +7 | +7 | 2 | 0 | yes |
| re2ob-checkoutservice-socket-2 | 3 | - | - | 0 | 0 | no |
| re2ob-checkoutservice-socket-3 | 3 | - | - | 0 | 0 | no |
| re2ob-currencyservice-cpu-2 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-cpu-3 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-delay-2 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-delay-3 | 5 | +718 | - | 1 | 0 | no |
| re2ob-currencyservice-disk-1 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-disk-2 | 6 | -712 | - | 2 | 2 | no |
| re2ob-currencyservice-disk-3 | 1 | +18 | +18 | 2 | 0 | yes |
| re2ob-currencyservice-loss-1 | 6 | +38 | - | 3 | 0 | no |
| re2ob-currencyservice-loss-2 | 5 | - | - | 0 | 0 | no |
| re2ob-currencyservice-loss-3 | 4 | +705 | - | 1 | 0 | no |
| re2ob-currencyservice-mem-2 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-mem-3 | 2 | - | - | 0 | 0 | no |
| re2ob-currencyservice-socket-1 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-socket-2 | 4 | - | - | 0 | 0 | no |
| re2ob-currencyservice-socket-3 | 4 | - | - | 0 | 0 | no |
| re2ob-emailservice-cpu-2 | 5 | - | - | 0 | 0 | no |
| re2ob-emailservice-cpu-3 | 1 | +703 | +703 | 2 | 0 | yes |
| re2ob-emailservice-delay-2 | 1 | +717 | +717 | 1 | 0 | yes |
| re2ob-emailservice-delay-3 | 1 | +715 | +715 | 1 | 0 | yes |
| re2ob-emailservice-disk-1 | 1 | +6 | +6 | 3 | 0 | yes |
| re2ob-emailservice-disk-2 | 1 | +708 | +708 | 1 | 0 | yes |
| re2ob-emailservice-disk-3 | 2 | -692 | +719 | 2 | 1 | no |
| re2ob-emailservice-loss-1 | 1 | +705 | +705 | 2 | 0 | yes |
| re2ob-emailservice-loss-2 | 9 | -90 | - | 1 | 1 | no |
| re2ob-emailservice-loss-3 | 8 | +718 | - | 2 | 0 | no |
| re2ob-emailservice-mem-2 | 1 | +2 | +2 | 1 | 0 | yes |
| re2ob-emailservice-mem-3 | 5 | +711 | - | 1 | 0 | no |
| re2ob-emailservice-socket-1 | 5 | - | - | 0 | 0 | no |
| re2ob-emailservice-socket-2 | 5 | - | - | 0 | 0 | no |
| re2ob-emailservice-socket-3 | 5 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-cpu-2 | 5 | +707 | - | 1 | 0 | no |
| re2ob-productcatalogservice-cpu-3 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-delay-2 | 2 | +706 | +718 | 2 | 0 | no |
| re2ob-productcatalogservice-delay-3 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-disk-1 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-disk-2 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-disk-3 | 1 | +11 | +11 | 1 | 0 | yes |
| re2ob-productcatalogservice-loss-1 | 3 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-loss-2 | 1 | +550 | +550 | 3 | 0 | tied |
| re2ob-productcatalogservice-loss-3 | 4 | -714 | - | 2 | 1 | no |
| re2ob-productcatalogservice-mem-2 | 3 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-mem-3 | 3 | +22 | - | 1 | 0 | no |
| re2ob-productcatalogservice-socket-1 | 9 | - | - | 0 | 0 | no |
| re2ob-productcatalogservice-socket-2 | 10 | +706 | - | 1 | 0 | no |
| re2ob-productcatalogservice-socket-3 | 9 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-cpu-2 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-cpu-3 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-delay-2 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-delay-3 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-disk-1 | 1 | +11 | +11 | 2 | 0 | yes |
| re2ob-recommendationservice-disk-2 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-disk-3 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-loss-1 | 7 | +448 | - | 2 | 0 | no |
| re2ob-recommendationservice-loss-2 | 11 | +713 | - | 1 | 0 | no |
| re2ob-recommendationservice-loss-3 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-mem-2 | 11 | +712 | - | 1 | 0 | no |
| re2ob-recommendationservice-mem-3 | 1 | +356 | +356 | 1 | 0 | yes |
| re2ob-recommendationservice-socket-1 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-socket-2 | 10 | - | - | 0 | 0 | no |
| re2ob-recommendationservice-socket-3 | 10 | - | - | 0 | 0 | no |

## Confusion (predicted -> labeled)

- redis -> checkoutservice
- adservice -> checkoutservice
- paymentservice -> checkoutservice
- paymentservice -> checkoutservice
- adservice -> checkoutservice
- adservice -> checkoutservice
- adservice -> checkoutservice
- emailservice -> checkoutservice
- adservice -> checkoutservice
- productcatalogservice -> checkoutservice
- adservice -> checkoutservice
- adservice -> checkoutservice
- adservice -> checkoutservice
- adservice -> checkoutservice
- adservice -> currencyservice
- adservice -> currencyservice
- adservice -> currencyservice
- redis -> currencyservice
- adservice -> currencyservice
- emailservice -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- adservice -> currencyservice
- frontend -> currencyservice
- adservice -> currencyservice
- adservice -> currencyservice
- adservice -> currencyservice
- adservice -> emailservice
- productcatalogservice -> emailservice
- adservice -> emailservice
- checkoutservice -> emailservice
- adservice -> emailservice
- adservice -> emailservice
- adservice -> emailservice
- adservice -> emailservice
- checkoutservice -> productcatalogservice
- adservice -> productcatalogservice
- redis -> productcatalogservice
- adservice -> productcatalogservice
- adservice -> productcatalogservice
- adservice -> productcatalogservice
- frontend -> productcatalogservice
- paymentservice -> productcatalogservice
- currencyservice -> productcatalogservice
- recommendationservice -> productcatalogservice
- adservice -> productcatalogservice
- redis -> productcatalogservice
- adservice -> productcatalogservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- currencyservice -> recommendationservice
- redis -> recommendationservice
- frontend -> recommendationservice
- redis -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
- adservice -> recommendationservice
