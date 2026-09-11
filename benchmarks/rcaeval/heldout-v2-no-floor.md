# RCA evaluation (75 incidents, rcaeval-re2-ob/v2-heldout (REAL RCAEval data))

Detector preset: v2-no-floor, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2-heldout`, commit `21e7346adc4b52e08deff9d4e1a4326436baa9f9` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `7ea58163cc96`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.120 |
| top-3 accuracy | 0.320 |
| MRR | 0.308 |
| Avg@5 | 0.325 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.300 | 0.500 | 0.437 | 0.440 | 10 |
| delay | 0.100 | 0.100 | 0.242 | 0.200 | 10 |
| disk | 0.200 | 0.400 | 0.351 | 0.333 | 15 |
| loss | 0.000 | 0.333 | 0.265 | 0.347 | 15 |
| mem | 0.200 | 0.400 | 0.412 | 0.480 | 10 |
| socket | 0.000 | 0.200 | 0.198 | 0.200 | 15 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.120 | 0.320 | 0.308 | 0.325 |
| no_critical_path | 0.133 | 0.320 | 0.315 | 0.328 |
| no_failed_trace_coverage | 0.147 | 0.360 | 0.329 | 0.339 |
| no_log_evidence | 0.120 | 0.320 | 0.307 | 0.320 |
| no_temporal_precedence | 0.120 | 0.373 | 0.310 | 0.325 |
| no_topology | 0.107 | 0.240 | 0.277 | 0.259 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-2 | 12 | -712 | +17 | 12 | 8 | no |
| re2ob-checkoutservice-cpu-3 | 3 | -715 | -715 | 7 | 6 | tied |
| re2ob-checkoutservice-delay-2 | 10 | -713 | -685 | 11 | 9 | no |
| re2ob-checkoutservice-delay-3 | 4 | -715 | -713 | 8 | 7 | no |
| re2ob-checkoutservice-disk-1 | 9 | -714 | -698 | 10 | 8 | no |
| re2ob-checkoutservice-disk-2 | 2 | -715 | -715 | 8 | 6 | tied |
| re2ob-checkoutservice-disk-3 | 6 | -715 | -76 | 8 | 5 | no |
| re2ob-checkoutservice-loss-1 | 3 | -715 | -714 | 10 | 7 | no |
| re2ob-checkoutservice-loss-2 | 2 | -715 | -715 | 11 | 11 | tied |
| re2ob-checkoutservice-loss-3 | 10 | -713 | -20 | 10 | 9 | no |
| re2ob-checkoutservice-mem-2 | 10 | -715 | -684 | 11 | 8 | no |
| re2ob-checkoutservice-mem-3 | 7 | -715 | -712 | 11 | 11 | no |
| re2ob-checkoutservice-socket-1 | 9 | -714 | +7 | 9 | 6 | no |
| re2ob-checkoutservice-socket-2 | 11 | -715 | -702 | 11 | 11 | no |
| re2ob-checkoutservice-socket-3 | 4 | -713 | -710 | 9 | 8 | no |
| re2ob-currencyservice-cpu-2 | 1 | -715 | -715 | 10 | 9 | tied |
| re2ob-currencyservice-cpu-3 | 6 | -714 | -506 | 8 | 7 | no |
| re2ob-currencyservice-delay-2 | 8 | -713 | -486 | 9 | 9 | no |
| re2ob-currencyservice-delay-3 | 8 | -715 | -706 | 11 | 9 | no |
| re2ob-currencyservice-disk-1 | 9 | -715 | -702 | 9 | 9 | no |
| re2ob-currencyservice-disk-2 | 9 | -712 | +14 | 10 | 7 | no |
| re2ob-currencyservice-disk-3 | 10 | -715 | +18 | 10 | 7 | no |
| re2ob-currencyservice-loss-1 | 9 | -715 | -689 | 10 | 9 | no |
| re2ob-currencyservice-loss-2 | 2 | -715 | -715 | 11 | 10 | tied |
| re2ob-currencyservice-loss-3 | 4 | -715 | -707 | 10 | 9 | no |
| re2ob-currencyservice-mem-2 | 1 | -714 | -714 | 10 | 8 | tied |
| re2ob-currencyservice-mem-3 | 4 | -715 | +8 | 10 | 7 | no |
| re2ob-currencyservice-socket-1 | 9 | -715 | -700 | 9 | 9 | no |
| re2ob-currencyservice-socket-2 | 2 | -713 | -710 | 9 | 8 | no |
| re2ob-currencyservice-socket-3 | 11 | -713 | +12 | 11 | 8 | no |
| re2ob-emailservice-cpu-2 | 10 | -715 | -711 | 11 | 10 | no |
| re2ob-emailservice-cpu-3 | 11 | -712 | -707 | 11 | 10 | no |
| re2ob-emailservice-delay-2 | 1 | -714 | -714 | 10 | 9 | yes |
| re2ob-emailservice-delay-3 | 4 | -715 | -710 | 10 | 10 | no |
| re2ob-emailservice-disk-1 | 8 | -712 | +3 | 9 | 7 | no |
| re2ob-emailservice-disk-2 | 9 | -715 | -687 | 10 | 10 | no |
| re2ob-emailservice-disk-3 | 7 | -715 | -706 | 8 | 7 | no |
| re2ob-emailservice-loss-1 | 6 | -714 | -714 | 11 | 11 | tied |
| re2ob-emailservice-loss-2 | 5 | -714 | -714 | 9 | 8 | yes |
| re2ob-emailservice-loss-3 | 5 | -715 | -715 | 10 | 10 | yes |
| re2ob-emailservice-mem-2 | 8 | -712 | -57 | 11 | 9 | no |
| re2ob-emailservice-mem-3 | 2 | -715 | -715 | 11 | 9 | tied |
| re2ob-emailservice-socket-1 | 8 | -714 | +5 | 10 | 7 | no |
| re2ob-emailservice-socket-2 | 2 | -714 | -711 | 9 | 6 | no |
| re2ob-emailservice-socket-3 | 10 | -711 | +2 | 10 | 9 | no |
| re2ob-productcatalogservice-cpu-2 | 1 | -712 | -706 | 9 | 9 | no |
| re2ob-productcatalogservice-cpu-3 | 2 | -715 | -713 | 10 | 10 | no |
| re2ob-productcatalogservice-delay-2 | 7 | -714 | -7 | 8 | 7 | no |
| re2ob-productcatalogservice-delay-3 | 5 | -715 | -705 | 10 | 8 | no |
| re2ob-productcatalogservice-disk-1 | 3 | -713 | +13 | 9 | 3 | no |
| re2ob-productcatalogservice-disk-2 | 1 | -715 | -714 | 10 | 9 | no |
| re2ob-productcatalogservice-disk-3 | 1 | -715 | -715 | 11 | 11 | yes |
| re2ob-productcatalogservice-loss-1 | 4 | -714 | +4 | 12 | 8 | no |
| re2ob-productcatalogservice-loss-2 | 5 | -715 | +9 | 11 | 9 | no |
| re2ob-productcatalogservice-loss-3 | 2 | -715 | -715 | 11 | 11 | tied |
| re2ob-productcatalogservice-mem-2 | 1 | -712 | -712 | 11 | 10 | tied |
| re2ob-productcatalogservice-mem-3 | 4 | -714 | +7 | 10 | 7 | no |
| re2ob-productcatalogservice-socket-1 | 6 | -715 | -682 | 9 | 7 | no |
| re2ob-productcatalogservice-socket-2 | 10 | -715 | +12 | 11 | 10 | no |
| re2ob-productcatalogservice-socket-3 | 10 | -715 | +5 | 11 | 10 | no |
| re2ob-recommendationservice-cpu-2 | 1 | -712 | -712 | 9 | 8 | tied |
| re2ob-recommendationservice-cpu-3 | 10 | -715 | +3 | 11 | 8 | no |
| re2ob-recommendationservice-delay-2 | 9 | -714 | -701 | 12 | 10 | no |
| re2ob-recommendationservice-delay-3 | 9 | -713 | +12 | 9 | 8 | no |
| re2ob-recommendationservice-disk-1 | 1 | -709 | -709 | 10 | 8 | yes |
| re2ob-recommendationservice-disk-2 | 3 | -714 | -707 | 8 | 7 | no |
| re2ob-recommendationservice-disk-3 | 8 | -715 | +6 | 8 | 6 | no |
| re2ob-recommendationservice-loss-1 | 3 | -715 | -715 | 11 | 7 | tied |
| re2ob-recommendationservice-loss-2 | 5 | -715 | -715 | 10 | 10 | tied |
| re2ob-recommendationservice-loss-3 | 8 | -715 | -674 | 9 | 7 | no |
| re2ob-recommendationservice-mem-2 | 4 | -714 | -708 | 10 | 9 | no |
| re2ob-recommendationservice-mem-3 | 2 | -715 | -715 | 8 | 6 | yes |
| re2ob-recommendationservice-socket-1 | 3 | -714 | -711 | 8 | 8 | no |
| re2ob-recommendationservice-socket-2 | 7 | -715 | -705 | 10 | 8 | no |
| re2ob-recommendationservice-socket-3 | 4 | -715 | -709 | 9 | 9 | no |

## Confusion (predicted -> labeled)

- currencyservice -> checkoutservice
- currencyservice -> checkoutservice
- recommendationservice -> checkoutservice
- frontend -> checkoutservice
- productcatalogservice -> checkoutservice
- currencyservice -> checkoutservice
- adservice -> checkoutservice
- frontend -> checkoutservice
- emailservice -> checkoutservice
- frontend -> checkoutservice
- emailservice -> checkoutservice
- paymentservice -> checkoutservice
- adservice -> checkoutservice
- productcatalogservice -> checkoutservice
- productcatalogservice -> checkoutservice
- productcatalogservice -> currencyservice
- emailservice -> currencyservice
- checkoutservice -> currencyservice
- checkoutservice -> currencyservice
- emailservice -> currencyservice
- emailservice -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- productcatalogservice -> currencyservice
- productcatalogservice -> currencyservice
- paymentservice -> currencyservice
- adservice -> emailservice
- paymentservice -> emailservice
- productcatalogservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> emailservice
- recommendationservice -> emailservice
- checkoutservice -> emailservice
- checkoutservice -> emailservice
- checkoutservice -> emailservice
- paymentservice -> emailservice
- currencyservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> emailservice
- productcatalogservice -> emailservice
- currencyservice -> productcatalogservice
- currencyservice -> productcatalogservice
- currencyservice -> productcatalogservice
- emailservice -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- checkoutservice -> productcatalogservice
- cartservice -> productcatalogservice
- emailservice -> productcatalogservice
- frontend -> recommendationservice
- currencyservice -> recommendationservice
- frontend -> recommendationservice
- currencyservice -> recommendationservice
- currencyservice -> recommendationservice
- frontend -> recommendationservice
- frontend -> recommendationservice
- frontend -> recommendationservice
- productcatalogservice -> recommendationservice
- currencyservice -> recommendationservice
- currencyservice -> recommendationservice
- emailservice -> recommendationservice
- emailservice -> recommendationservice
