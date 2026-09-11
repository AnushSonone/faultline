# RCA evaluation (15 incidents, rcaeval-re2-ob/v2 (REAL RCAEval data))

Detector preset: v2-no-persistence, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2`, commit `1e42d2462f51a39dfbb5c800778809e763e3c3d3` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `7e2ff342bdbe`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.133 |
| top-3 accuracy | 0.600 |
| MRR | 0.403 |
| Avg@5 | 0.533 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.400 | 0.600 | 0.600 | 0.720 | 5 |
| delay | 0.000 | 0.400 | 0.269 | 0.320 | 5 |
| mem | 0.000 | 0.800 | 0.340 | 0.560 | 5 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.133 | 0.600 | 0.403 | 0.533 |
| no_critical_path | 0.200 | 0.600 | 0.436 | 0.547 |
| no_failed_trace_coverage | 0.133 | 0.533 | 0.383 | 0.493 |
| no_log_evidence | 0.133 | 0.600 | 0.403 | 0.533 |
| no_temporal_precedence | 0.467 | 0.733 | 0.643 | 0.720 |
| no_topology | 0.000 | 0.533 | 0.317 | 0.467 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-1 | 2 | -691 | -684 | 6 | 5 | no |
| re2ob-checkoutservice-delay-1 | 3 | -693 | -685 | 6 | 5 | no |
| re2ob-checkoutservice-mem-1 | 3 | -580 | +11 | 5 | 2 | no |
| re2ob-currencyservice-cpu-1 | 1 | -521 | +15 | 7 | 2 | no |
| re2ob-currencyservice-delay-1 | 6 | -709 | +24 | 8 | 5 | no |
| re2ob-currencyservice-mem-1 | 5 | -643 | +20 | 9 | 5 | no |
| re2ob-emailservice-cpu-1 | 4 | -708 | -701 | 7 | 6 | no |
| re2ob-emailservice-delay-1 | 2 | -695 | -656 | 5 | 5 | no |
| re2ob-emailservice-mem-1 | 3 | -473 | +15 | 5 | 2 | no |
| re2ob-productcatalogservice-cpu-1 | 1 | -710 | -710 | 11 | 10 | tied |
| re2ob-productcatalogservice-delay-1 | 7 | -707 | +28 | 8 | 5 | no |
| re2ob-productcatalogservice-mem-1 | 2 | -653 | +17 | 10 | 4 | no |
| re2ob-recommendationservice-cpu-1 | 4 | -707 | +12 | 7 | 5 | no |
| re2ob-recommendationservice-delay-1 | 5 | -701 | +10 | 7 | 5 | no |
| re2ob-recommendationservice-mem-1 | 3 | -674 | +8 | 8 | 6 | no |

## Confusion (predicted -> labeled)

- redis -> checkoutservice
- emailservice -> checkoutservice
- redis -> checkoutservice
- redis -> currencyservice
- checkoutservice -> currencyservice
- paymentservice -> emailservice
- redis -> emailservice
- redis -> emailservice
- checkoutservice -> productcatalogservice
- frontend -> productcatalogservice
- adservice -> recommendationservice
- paymentservice -> recommendationservice
- checkoutservice -> recommendationservice
