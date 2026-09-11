# RCA evaluation (15 incidents, rcaeval-re2-ob/v2 (REAL RCAEval data))

Detector preset: v2, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2`, commit `1e42d2462f51a39dfbb5c800778809e763e3c3d3` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `334d134a9672`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.733 |
| top-3 accuracy | 1.000 |
| MRR | 0.844 |
| Avg@5 | 0.920 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.800 | 1.000 | 0.900 | 0.960 | 5 |
| delay | 0.600 | 1.000 | 0.733 | 0.840 | 5 |
| mem | 0.800 | 1.000 | 0.900 | 0.960 | 5 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.733 | 1.000 | 0.844 | 0.920 |
| no_critical_path | 0.800 | 1.000 | 0.878 | 0.933 |
| no_failed_trace_coverage | 0.733 | 1.000 | 0.844 | 0.920 |
| no_log_evidence | 0.733 | 1.000 | 0.844 | 0.920 |
| no_temporal_precedence | 0.800 | 1.000 | 0.889 | 0.947 |
| no_topology | 0.733 | 0.933 | 0.850 | 0.920 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-1 | 1 | +14 | +14 | 1 | 0 | yes |
| re2ob-checkoutservice-delay-1 | 3 | +12 | +12 | 4 | 0 | tied |
| re2ob-checkoutservice-mem-1 | 1 | +11 | +11 | 1 | 0 | yes |
| re2ob-currencyservice-cpu-1 | 1 | +36 | +36 | 4 | 0 | tied |
| re2ob-currencyservice-delay-1 | 1 | +24 | +24 | 3 | 0 | tied |
| re2ob-currencyservice-mem-1 | 1 | +20 | +20 | 4 | 0 | yes |
| re2ob-emailservice-cpu-1 | 1 | +12 | +12 | 1 | 0 | yes |
| re2ob-emailservice-delay-1 | 1 | +19 | +19 | 2 | 0 | yes |
| re2ob-emailservice-mem-1 | 1 | +15 | +15 | 2 | 0 | yes |
| re2ob-productcatalogservice-cpu-1 | 2 | +14 | +22 | 2 | 0 | no |
| re2ob-productcatalogservice-delay-1 | 3 | +13 | +28 | 4 | 0 | no |
| re2ob-productcatalogservice-mem-1 | 2 | +17 | +17 | 6 | 0 | yes |
| re2ob-recommendationservice-cpu-1 | 1 | +12 | +12 | 1 | 0 | yes |
| re2ob-recommendationservice-delay-1 | 1 | +10 | +10 | 2 | 0 | yes |
| re2ob-recommendationservice-mem-1 | 1 | +8 | +8 | 2 | 0 | yes |

## Confusion (predicted -> labeled)

- emailservice -> checkoutservice
- recommendationservice -> productcatalogservice
- recommendationservice -> productcatalogservice
- frontend -> productcatalogservice
