# RCA evaluation (15 incidents, rcaeval-re2-ob/v2 (REAL RCAEval data))

Detector preset: v2-no-floor, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2`, commit `1e42d2462f51a39dfbb5c800778809e763e3c3d3` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `7ea58163cc96`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.133 |
| top-3 accuracy | 0.333 |
| MRR | 0.305 |
| Avg@5 | 0.280 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.200 | 0.400 | 0.337 | 0.320 | 5 |
| delay | 0.000 | 0.200 | 0.170 | 0.120 | 5 |
| mem | 0.200 | 0.400 | 0.407 | 0.400 | 5 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.133 | 0.333 | 0.305 | 0.280 |
| no_critical_path | 0.200 | 0.333 | 0.338 | 0.293 |
| no_failed_trace_coverage | 0.133 | 0.333 | 0.305 | 0.280 |
| no_log_evidence | 0.133 | 0.333 | 0.305 | 0.280 |
| no_temporal_precedence | 0.133 | 0.400 | 0.327 | 0.333 |
| no_topology | 0.133 | 0.267 | 0.294 | 0.253 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-1 | 3 | -714 | -710 | 10 | 10 | no |
| re2ob-checkoutservice-delay-1 | 8 | -715 | +12 | 10 | 7 | no |
| re2ob-checkoutservice-mem-1 | 6 | -715 | -702 | 8 | 8 | no |
| re2ob-currencyservice-cpu-1 | 1 | -715 | -715 | 9 | 8 | tied |
| re2ob-currencyservice-delay-1 | 3 | -714 | -711 | 9 | 8 | no |
| re2ob-currencyservice-mem-1 | 6 | -715 | -710 | 9 | 7 | no |
| re2ob-emailservice-cpu-1 | 10 | -714 | +12 | 11 | 10 | no |
| re2ob-emailservice-delay-1 | 8 | -715 | -689 | 11 | 9 | no |
| re2ob-emailservice-mem-1 | 5 | -714 | -712 | 9 | 6 | no |
| re2ob-productcatalogservice-cpu-1 | 9 | -714 | -701 | 10 | 9 | no |
| re2ob-productcatalogservice-delay-1 | 7 | -714 | +13 | 10 | 7 | no |
| re2ob-productcatalogservice-mem-1 | 2 | -714 | -713 | 12 | 9 | no |
| re2ob-recommendationservice-cpu-1 | 7 | -714 | -709 | 10 | 9 | no |
| re2ob-recommendationservice-delay-1 | 8 | -715 | -223 | 10 | 8 | no |
| re2ob-recommendationservice-mem-1 | 1 | -715 | -715 | 12 | 11 | yes |

## Confusion (predicted -> labeled)

- emailservice -> checkoutservice
- currencyservice -> checkoutservice
- currencyservice -> checkoutservice
- paymentservice -> currencyservice
- emailservice -> currencyservice
- productcatalogservice -> emailservice
- productcatalogservice -> emailservice
- productcatalogservice -> emailservice
- checkoutservice -> productcatalogservice
- currencyservice -> productcatalogservice
- frontend -> productcatalogservice
- checkoutservice -> recommendationservice
- productcatalogservice -> recommendationservice
