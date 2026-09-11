# RCA evaluation (75 incidents, rcaeval-re2-ob/v2-heldout (REAL RCAEval data))

Detector preset: v2, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2-heldout`, commit `21e7346adc4b52e08deff9d4e1a4326436baa9f9` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `334d134a9672`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.773 |
| top-3 accuracy | 0.973 |
| MRR | 0.867 |
| Avg@5 | 0.928 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 1.000 | 1.000 | 1.000 | 1.000 | 10 |
| delay | 1.000 | 1.000 | 1.000 | 1.000 | 10 |
| disk | 0.800 | 1.000 | 0.878 | 0.933 | 15 |
| loss | 0.200 | 0.867 | 0.522 | 0.733 | 15 |
| mem | 0.800 | 1.000 | 0.900 | 0.960 | 10 |
| socket | 1.000 | 1.000 | 1.000 | 1.000 | 15 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.773 | 0.973 | 0.867 | 0.928 |
| no_critical_path | 0.813 | 0.987 | 0.888 | 0.939 |
| no_failed_trace_coverage | 0.787 | 0.973 | 0.876 | 0.933 |
| no_log_evidence | 0.773 | 0.960 | 0.866 | 0.925 |
| no_temporal_precedence | 0.787 | 0.987 | 0.883 | 0.944 |
| no_topology | 0.680 | 0.933 | 0.811 | 0.891 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-2 | 1 | +24 | +24 | 8 | 0 | yes |
| re2ob-checkoutservice-cpu-3 | 1 | +5 | +5 | 1 | 0 | yes |
| re2ob-checkoutservice-delay-2 | 1 | +25 | +25 | 4 | 0 | yes |
| re2ob-checkoutservice-delay-3 | 1 | +19 | +19 | 4 | 0 | yes |
| re2ob-checkoutservice-disk-1 | 1 | +10 | +10 | 2 | 0 | yes |
| re2ob-checkoutservice-disk-2 | 1 | +9 | +9 | 1 | 0 | yes |
| re2ob-checkoutservice-disk-3 | 1 | +16 | +16 | 1 | 0 | yes |
| re2ob-checkoutservice-loss-1 | 1 | +21 | +21 | 2 | 0 | yes |
| re2ob-checkoutservice-loss-2 | 1 | +29 | +29 | 1 | 0 | yes |
| re2ob-checkoutservice-loss-3 | 3 | -705 | +10 | 3 | 2 | no |
| re2ob-checkoutservice-mem-2 | 1 | +6 | +6 | 2 | 0 | yes |
| re2ob-checkoutservice-mem-3 | 1 | +12 | +12 | 1 | 0 | yes |
| re2ob-checkoutservice-socket-1 | 1 | +7 | +7 | 3 | 0 | yes |
| re2ob-checkoutservice-socket-2 | 1 | +14 | +14 | 1 | 0 | yes |
| re2ob-checkoutservice-socket-3 | 1 | +10 | +10 | 1 | 0 | yes |
| re2ob-currencyservice-cpu-2 | 1 | +35 | +35 | 3 | 0 | tied |
| re2ob-currencyservice-cpu-3 | 1 | +33 | +33 | 4 | 0 | tied |
| re2ob-currencyservice-delay-2 | 1 | +18 | +18 | 3 | 0 | tied |
| re2ob-currencyservice-delay-3 | 1 | +22 | +22 | 3 | 0 | tied |
| re2ob-currencyservice-disk-1 | 1 | +12 | +12 | 3 | 0 | yes |
| re2ob-currencyservice-disk-2 | 3 | -712 | +14 | 6 | 2 | no |
| re2ob-currencyservice-disk-3 | 1 | +19 | +19 | 4 | 0 | yes |
| re2ob-currencyservice-loss-1 | 2 | +21 | +21 | 6 | 0 | tied |
| re2ob-currencyservice-loss-2 | 3 | -692 | +20 | 6 | 1 | no |
| re2ob-currencyservice-loss-3 | 3 | +15 | +28 | 5 | 0 | no |
| re2ob-currencyservice-mem-2 | 1 | +15 | +15 | 5 | 0 | yes |
| re2ob-currencyservice-mem-3 | 2 | +8 | +8 | 6 | 0 | yes |
| re2ob-currencyservice-socket-1 | 1 | +26 | +26 | 1 | 0 | yes |
| re2ob-currencyservice-socket-2 | 1 | +3 | +3 | 3 | 0 | yes |
| re2ob-currencyservice-socket-3 | 1 | +12 | +12 | 4 | 0 | yes |
| re2ob-emailservice-cpu-2 | 1 | +3 | +3 | 1 | 0 | yes |
| re2ob-emailservice-cpu-3 | 1 | +14 | +14 | 3 | 0 | yes |
| re2ob-emailservice-delay-2 | 1 | +33 | +33 | 2 | 0 | tied |
| re2ob-emailservice-delay-3 | 1 | +16 | +16 | 2 | 0 | yes |
| re2ob-emailservice-disk-1 | 1 | +6 | +6 | 3 | 0 | yes |
| re2ob-emailservice-disk-2 | 1 | +17 | +17 | 1 | 0 | yes |
| re2ob-emailservice-disk-3 | 2 | -692 | +7 | 3 | 1 | no |
| re2ob-emailservice-loss-1 | 1 | +67 | +67 | 2 | 0 | yes |
| re2ob-emailservice-loss-2 | 4 | +33 | +206 | 2 | 0 | no |
| re2ob-emailservice-loss-3 | 2 | +42 | +42 | 2 | 0 | yes |
| re2ob-emailservice-mem-2 | 1 | +2 | +2 | 2 | 0 | yes |
| re2ob-emailservice-mem-3 | 1 | +7 | +7 | 2 | 0 | yes |
| re2ob-emailservice-socket-1 | 1 | +5 | +5 | 1 | 0 | yes |
| re2ob-emailservice-socket-2 | 1 | +15 | +15 | 2 | 0 | yes |
| re2ob-emailservice-socket-3 | 1 | +13 | +13 | 1 | 0 | yes |
| re2ob-productcatalogservice-cpu-2 | 1 | +17 | +17 | 4 | 0 | tied |
| re2ob-productcatalogservice-cpu-3 | 1 | +15 | +18 | 4 | 0 | no |
| re2ob-productcatalogservice-delay-2 | 1 | +13 | +23 | 4 | 0 | no |
| re2ob-productcatalogservice-delay-3 | 1 | +15 | +15 | 4 | 0 | tied |
| re2ob-productcatalogservice-disk-1 | 1 | +14 | +14 | 2 | 0 | yes |
| re2ob-productcatalogservice-disk-2 | 1 | +8 | +8 | 3 | 0 | yes |
| re2ob-productcatalogservice-disk-3 | 3 | -699 | +11 | 4 | 2 | no |
| re2ob-productcatalogservice-loss-1 | 2 | +10 | +32 | 5 | 0 | no |
| re2ob-productcatalogservice-loss-2 | 3 | +15 | +40 | 7 | 0 | no |
| re2ob-productcatalogservice-loss-3 | 4 | -714 | +29 | 8 | 1 | no |
| re2ob-productcatalogservice-mem-2 | 1 | +14 | +14 | 7 | 0 | tied |
| re2ob-productcatalogservice-mem-3 | 2 | +11 | +11 | 6 | 0 | yes |
| re2ob-productcatalogservice-socket-1 | 1 | +3 | +3 | 5 | 0 | yes |
| re2ob-productcatalogservice-socket-2 | 1 | +12 | +12 | 4 | 0 | tied |
| re2ob-productcatalogservice-socket-3 | 1 | +9 | +9 | 3 | 0 | yes |
| re2ob-recommendationservice-cpu-2 | 1 | +17 | +17 | 2 | 0 | yes |
| re2ob-recommendationservice-cpu-3 | 1 | +17 | +17 | 1 | 0 | yes |
| re2ob-recommendationservice-delay-2 | 1 | +14 | +14 | 2 | 0 | tied |
| re2ob-recommendationservice-delay-3 | 1 | +12 | +12 | 2 | 0 | yes |
| re2ob-recommendationservice-disk-1 | 1 | +11 | +11 | 1 | 0 | yes |
| re2ob-recommendationservice-disk-2 | 1 | +18 | +18 | 2 | 0 | yes |
| re2ob-recommendationservice-disk-3 | 1 | +6 | +6 | 3 | 0 | yes |
| re2ob-recommendationservice-loss-1 | 2 | +28 | +28 | 7 | 0 | yes |
| re2ob-recommendationservice-loss-2 | 2 | +20 | +20 | 2 | 0 | tied |
| re2ob-recommendationservice-loss-3 | 2 | +19 | +19 | 4 | 0 | yes |
| re2ob-recommendationservice-mem-2 | 1 | +15 | +15 | 3 | 0 | yes |
| re2ob-recommendationservice-mem-3 | 1 | +16 | +16 | 2 | 0 | yes |
| re2ob-recommendationservice-socket-1 | 1 | +9 | +9 | 3 | 0 | yes |
| re2ob-recommendationservice-socket-2 | 1 | +13 | +13 | 1 | 0 | yes |
| re2ob-recommendationservice-socket-3 | 1 | +14 | +14 | 1 | 0 | yes |

## Confusion (predicted -> labeled)

- productcatalogservice -> checkoutservice
- emailservice -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- productcatalogservice -> emailservice
- checkoutservice -> emailservice
- checkoutservice -> emailservice
- paymentservice -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> recommendationservice
- frontend -> recommendationservice
- frontend -> recommendationservice
