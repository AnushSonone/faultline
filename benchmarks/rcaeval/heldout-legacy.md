# RCA evaluation (75 incidents, rcaeval-re2-ob/v2-heldout (REAL RCAEval data))

Detector: legacy detector (2026-08-03 configuration), spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2-heldout`, commit `21e7346adc4b52e08deff9d4e1a4326436baa9f9` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `7bf78f87093c`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.160 |
| top-3 accuracy | 0.360 |
| MRR | 0.336 |
| Avg@5 | 0.352 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.200 | 0.400 | 0.361 | 0.380 | 10 |
| delay | 0.200 | 0.300 | 0.307 | 0.260 | 10 |
| disk | 0.267 | 0.400 | 0.382 | 0.373 | 15 |
| loss | 0.000 | 0.333 | 0.269 | 0.347 | 15 |
| mem | 0.200 | 0.500 | 0.428 | 0.480 | 10 |
| socket | 0.133 | 0.267 | 0.297 | 0.293 | 15 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.160 | 0.360 | 0.336 | 0.352 |
| no_critical_path | 0.187 | 0.373 | 0.351 | 0.360 |
| no_failed_trace_coverage | 0.187 | 0.400 | 0.362 | 0.381 |
| no_log_evidence | 0.160 | 0.360 | 0.336 | 0.352 |
| no_temporal_precedence | 0.160 | 0.427 | 0.346 | 0.389 |
| no_topology | 0.027 | 0.240 | 0.221 | 0.227 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-2 | 8 | -715 | -708 | 12 | 12 | no |
| re2ob-checkoutservice-cpu-3 | 3 | -715 | -715 | 12 | 12 | tied |
| re2ob-checkoutservice-delay-2 | 11 | -714 | -708 | 12 | 12 | no |
| re2ob-checkoutservice-delay-3 | 6 | -715 | -713 | 12 | 12 | no |
| re2ob-checkoutservice-disk-1 | 3 | -715 | -713 | 12 | 12 | no |
| re2ob-checkoutservice-disk-2 | 3 | -715 | -715 | 11 | 11 | tied |
| re2ob-checkoutservice-disk-3 | 4 | -715 | -714 | 11 | 11 | no |
| re2ob-checkoutservice-loss-1 | 7 | -715 | -714 | 12 | 12 | no |
| re2ob-checkoutservice-loss-2 | 2 | -715 | -715 | 12 | 12 | tied |
| re2ob-checkoutservice-loss-3 | 2 | -714 | -714 | 12 | 12 | yes |
| re2ob-checkoutservice-mem-2 | 4 | -715 | -715 | 12 | 12 | tied |
| re2ob-checkoutservice-mem-3 | 10 | -715 | -712 | 12 | 12 | no |
| re2ob-checkoutservice-socket-1 | 11 | -715 | -711 | 12 | 12 | no |
| re2ob-checkoutservice-socket-2 | 12 | -715 | -709 | 12 | 12 | no |
| re2ob-checkoutservice-socket-3 | 7 | -715 | -710 | 12 | 12 | no |
| re2ob-currencyservice-cpu-2 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-cpu-3 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-delay-2 | 12 | -715 | -708 | 12 | 12 | no |
| re2ob-currencyservice-delay-3 | 10 | -715 | -713 | 12 | 12 | no |
| re2ob-currencyservice-disk-1 | 12 | -715 | -707 | 12 | 12 | no |
| re2ob-currencyservice-disk-2 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-disk-3 | 12 | -715 | -710 | 12 | 12 | no |
| re2ob-currencyservice-loss-1 | 3 | -715 | -714 | 12 | 12 | no |
| re2ob-currencyservice-loss-2 | 3 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-loss-3 | 4 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-mem-2 | 1 | -715 | -714 | 12 | 12 | no |
| re2ob-currencyservice-mem-3 | 6 | -715 | -711 | 12 | 12 | no |
| re2ob-currencyservice-socket-1 | 2 | -715 | -715 | 12 | 12 | tied |
| re2ob-currencyservice-socket-2 | 3 | -713 | -711 | 12 | 12 | no |
| re2ob-currencyservice-socket-3 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-emailservice-cpu-2 | 8 | -715 | -714 | 12 | 12 | no |
| re2ob-emailservice-cpu-3 | 12 | -714 | -708 | 12 | 12 | no |
| re2ob-emailservice-delay-2 | 12 | -715 | -714 | 12 | 12 | no |
| re2ob-emailservice-delay-3 | 11 | -715 | -710 | 12 | 12 | no |
| re2ob-emailservice-disk-1 | 12 | -715 | -703 | 12 | 12 | no |
| re2ob-emailservice-disk-2 | 12 | -715 | -702 | 12 | 12 | no |
| re2ob-emailservice-disk-3 | 11 | -715 | -706 | 12 | 12 | no |
| re2ob-emailservice-loss-1 | 8 | -715 | -714 | 12 | 12 | no |
| re2ob-emailservice-loss-2 | 7 | -715 | -714 | 12 | 12 | no |
| re2ob-emailservice-loss-3 | 7 | -715 | -715 | 12 | 12 | tied |
| re2ob-emailservice-mem-2 | 8 | -715 | -708 | 12 | 12 | no |
| re2ob-emailservice-mem-3 | 2 | -715 | -715 | 12 | 12 | tied |
| re2ob-emailservice-socket-1 | 12 | -715 | -705 | 12 | 12 | no |
| re2ob-emailservice-socket-2 | 5 | -715 | -711 | 12 | 12 | no |
| re2ob-emailservice-socket-3 | 6 | -715 | -713 | 12 | 12 | no |
| re2ob-productcatalogservice-cpu-2 | 12 | -714 | -706 | 12 | 12 | no |
| re2ob-productcatalogservice-cpu-3 | 2 | -715 | -713 | 12 | 12 | no |
| re2ob-productcatalogservice-delay-2 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-productcatalogservice-delay-3 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-productcatalogservice-disk-1 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-productcatalogservice-disk-2 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-productcatalogservice-disk-3 | 1 | -715 | -715 | 12 | 12 | tied |
| re2ob-productcatalogservice-loss-1 | 4 | -715 | -706 | 12 | 12 | no |
| re2ob-productcatalogservice-loss-2 | 5 | -715 | -710 | 12 | 12 | no |
| re2ob-productcatalogservice-loss-3 | 2 | -715 | -715 | 12 | 12 | tied |
| re2ob-productcatalogservice-mem-2 | 1 | -714 | -714 | 12 | 12 | tied |
| re2ob-productcatalogservice-mem-3 | 2 | -715 | -715 | 12 | 12 | yes |
| re2ob-productcatalogservice-socket-1 | 8 | -715 | -712 | 12 | 12 | no |
| re2ob-productcatalogservice-socket-2 | 5 | -715 | -714 | 12 | 12 | no |
| re2ob-productcatalogservice-socket-3 | 1 | -715 | -714 | 12 | 12 | no |
| re2ob-recommendationservice-cpu-2 | 4 | -715 | -712 | 12 | 12 | no |
| re2ob-recommendationservice-cpu-3 | 9 | -715 | -713 | 12 | 12 | no |
| re2ob-recommendationservice-delay-2 | 8 | -714 | -709 | 12 | 12 | no |
| re2ob-recommendationservice-delay-3 | 3 | -715 | -715 | 12 | 12 | tied |
| re2ob-recommendationservice-disk-1 | 8 | -715 | -709 | 12 | 12 | no |
| re2ob-recommendationservice-disk-2 | 10 | -714 | -711 | 12 | 12 | no |
| re2ob-recommendationservice-disk-3 | 6 | -715 | -715 | 12 | 12 | tied |
| re2ob-recommendationservice-loss-1 | 4 | -715 | -715 | 12 | 12 | tied |
| re2ob-recommendationservice-loss-2 | 5 | -715 | -715 | 12 | 12 | tied |
| re2ob-recommendationservice-loss-3 | 6 | -715 | -715 | 12 | 12 | tied |
| re2ob-recommendationservice-mem-2 | 7 | -715 | -708 | 12 | 12 | no |
| re2ob-recommendationservice-mem-3 | 2 | -715 | -715 | 12 | 12 | tied |
| re2ob-recommendationservice-socket-1 | 4 | -714 | -711 | 12 | 12 | no |
| re2ob-recommendationservice-socket-2 | 12 | -715 | -707 | 12 | 12 | no |
| re2ob-recommendationservice-socket-3 | 5 | -715 | -715 | 12 | 12 | tied |

## Confusion (predicted -> labeled)

- currencyservice -> checkoutservice
- productcatalogservice -> checkoutservice
- productcatalogservice -> checkoutservice
- currencyservice -> checkoutservice
- currencyservice -> checkoutservice
- productcatalogservice -> checkoutservice
- emailservice -> checkoutservice
- frontend -> checkoutservice
- emailservice -> checkoutservice
- frontend -> checkoutservice
- currencyservice -> checkoutservice
- currencyservice -> checkoutservice
- currencyservice -> checkoutservice
- paymentservice -> checkoutservice
- productcatalogservice -> checkoutservice
- frontend -> currencyservice
- paymentservice -> currencyservice
- checkoutservice -> currencyservice
- checkoutservice -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- productcatalogservice -> currencyservice
- frontend -> currencyservice
- productcatalogservice -> currencyservice
- productcatalogservice -> currencyservice
- adservice -> emailservice
- paymentservice -> emailservice
- productcatalogservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> emailservice
- currencyservice -> emailservice
- checkoutservice -> emailservice
- checkoutservice -> emailservice
- productcatalogservice -> emailservice
- checkoutservice -> emailservice
- currencyservice -> emailservice
- currencyservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> productcatalogservice
- currencyservice -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- emailservice -> productcatalogservice
- currencyservice -> productcatalogservice
- currencyservice -> recommendationservice
- productcatalogservice -> recommendationservice
- paymentservice -> recommendationservice
- currencyservice -> recommendationservice
- currencyservice -> recommendationservice
- currencyservice -> recommendationservice
- productcatalogservice -> recommendationservice
- frontend -> recommendationservice
- productcatalogservice -> recommendationservice
- frontend -> recommendationservice
- currencyservice -> recommendationservice
- paymentservice -> recommendationservice
- currencyservice -> recommendationservice
- currencyservice -> recommendationservice
- productcatalogservice -> recommendationservice
