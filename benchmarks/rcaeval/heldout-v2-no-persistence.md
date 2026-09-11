# RCA evaluation (75 incidents, rcaeval-re2-ob/v2-heldout (REAL RCAEval data))

Detector preset: v2-no-persistence, spec 18.4 ranking weights.

Protocol: dataset `rcaeval-re2-ob/v2-heldout`, commit `21e7346adc4b52e08deff9d4e1a4326436baa9f9` (0 dirty files in crates apps Cargo.toml Cargo.lock rust-toolchain.toml), feature config sha256 `7e2ff342bdbe`, ranking weights sha256 `dc0686ec7e0b`.

| metric | value |
|---|---|
| top-1 accuracy | 0.093 |
| top-3 accuracy | 0.600 |
| MRR | 0.378 |
| Avg@5 | 0.493 |

## Per fault type

| fault | top-1 | top-3 | MRR | Avg@5 | n |
|---|---|---|---|---|---|
| cpu | 0.100 | 0.500 | 0.371 | 0.440 | 10 |
| delay | 0.100 | 0.700 | 0.387 | 0.520 | 10 |
| disk | 0.133 | 0.533 | 0.374 | 0.467 | 15 |
| loss | 0.000 | 0.467 | 0.301 | 0.387 | 15 |
| mem | 0.200 | 0.900 | 0.550 | 0.740 | 10 |
| socket | 0.067 | 0.600 | 0.346 | 0.480 | 15 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR | Avg@5 |
|---|---|---|---|---|
| no_change_proximity | 0.093 | 0.600 | 0.378 | 0.493 |
| no_critical_path | 0.120 | 0.600 | 0.392 | 0.499 |
| no_failed_trace_coverage | 0.093 | 0.573 | 0.371 | 0.477 |
| no_log_evidence | 0.093 | 0.600 | 0.377 | 0.491 |
| no_temporal_precedence | 0.467 | 0.720 | 0.638 | 0.704 |
| no_topology | 0.040 | 0.520 | 0.323 | 0.429 |

## Onsets (seconds relative to labeled fault start)

| incident | best rank | incident onset | root-cause onset | services with onset | before fault | root cause earliest |
|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-2 | 1 | -713 | -708 | 10 | 4 | no |
| re2ob-checkoutservice-cpu-3 | 3 | -703 | -81 | 6 | 5 | no |
| re2ob-checkoutservice-delay-2 | 6 | -704 | -170 | 8 | 6 | no |
| re2ob-checkoutservice-delay-3 | 3 | -709 | -334 | 6 | 5 | no |
| re2ob-checkoutservice-disk-1 | 3 | -533 | +10 | 5 | 3 | no |
| re2ob-checkoutservice-disk-2 | 2 | -672 | -595 | 5 | 4 | no |
| re2ob-checkoutservice-disk-3 | 2 | -669 | -477 | 5 | 4 | no |
| re2ob-checkoutservice-loss-1 | 3 | -711 | -444 | 8 | 5 | no |
| re2ob-checkoutservice-loss-2 | 2 | -549 | -538 | 7 | 3 | no |
| re2ob-checkoutservice-loss-3 | 2 | -714 | -714 | 10 | 9 | yes |
| re2ob-checkoutservice-mem-2 | 3 | -710 | -219 | 6 | 5 | no |
| re2ob-checkoutservice-mem-3 | 2 | -700 | -678 | 6 | 5 | no |
| re2ob-checkoutservice-socket-1 | 6 | -715 | -680 | 10 | 10 | no |
| re2ob-checkoutservice-socket-2 | 3 | -642 | -552 | 5 | 5 | no |
| re2ob-checkoutservice-socket-3 | 3 | -711 | +10 | 5 | 2 | no |
| re2ob-currencyservice-cpu-2 | 6 | -569 | +35 | 9 | 5 | no |
| re2ob-currencyservice-cpu-3 | 8 | -704 | +33 | 9 | 6 | no |
| re2ob-currencyservice-delay-2 | 5 | -680 | +18 | 7 | 5 | no |
| re2ob-currencyservice-delay-3 | 2 | -675 | +22 | 7 | 3 | no |
| re2ob-currencyservice-disk-1 | 7 | -683 | +12 | 8 | 6 | no |
| re2ob-currencyservice-disk-2 | 7 | -712 | +14 | 9 | 5 | no |
| re2ob-currencyservice-disk-3 | 6 | -710 | +19 | 9 | 5 | no |
| re2ob-currencyservice-loss-1 | 6 | -709 | +21 | 12 | 4 | no |
| re2ob-currencyservice-loss-2 | 7 | -715 | +20 | 12 | 6 | no |
| re2ob-currencyservice-loss-3 | 7 | -655 | +28 | 12 | 6 | no |
| re2ob-currencyservice-mem-2 | 2 | -684 | +15 | 9 | 4 | no |
| re2ob-currencyservice-mem-3 | 2 | -610 | +8 | 9 | 5 | no |
| re2ob-currencyservice-socket-1 | 6 | -702 | +26 | 7 | 6 | no |
| re2ob-currencyservice-socket-2 | 1 | -557 | +3 | 8 | 3 | no |
| re2ob-currencyservice-socket-3 | 5 | -681 | +12 | 9 | 5 | no |
| re2ob-emailservice-cpu-2 | 6 | -709 | +3 | 6 | 5 | no |
| re2ob-emailservice-cpu-3 | 2 | -708 | -706 | 5 | 5 | no |
| re2ob-emailservice-delay-2 | 3 | -700 | -297 | 6 | 5 | no |
| re2ob-emailservice-delay-3 | 3 | -637 | -539 | 6 | 5 | no |
| re2ob-emailservice-disk-1 | 5 | -708 | +6 | 6 | 5 | no |
| re2ob-emailservice-disk-2 | 3 | -615 | +17 | 6 | 2 | no |
| re2ob-emailservice-disk-3 | 4 | -696 | +7 | 5 | 4 | no |
| re2ob-emailservice-loss-1 | 2 | -698 | -698 | 7 | 7 | yes |
| re2ob-emailservice-loss-2 | 5 | -597 | +46 | 5 | 4 | no |
| re2ob-emailservice-loss-3 | 3 | -601 | -573 | 5 | 4 | no |
| re2ob-emailservice-mem-2 | 1 | -687 | -687 | 5 | 5 | tied |
| re2ob-emailservice-mem-3 | 2 | -685 | -669 | 5 | 5 | no |
| re2ob-emailservice-socket-1 | 4 | -573 | -365 | 5 | 4 | no |
| re2ob-emailservice-socket-2 | 5 | -630 | +15 | 5 | 4 | no |
| re2ob-emailservice-socket-3 | 5 | -654 | +13 | 5 | 4 | no |
| re2ob-productcatalogservice-cpu-2 | 4 | -708 | +17 | 8 | 4 | no |
| re2ob-productcatalogservice-cpu-3 | 6 | -710 | +18 | 9 | 5 | no |
| re2ob-productcatalogservice-delay-2 | 6 | -680 | +23 | 8 | 5 | no |
| re2ob-productcatalogservice-delay-3 | 1 | -705 | +15 | 8 | 3 | no |
| re2ob-productcatalogservice-disk-1 | 1 | -542 | +14 | 8 | 3 | no |
| re2ob-productcatalogservice-disk-2 | 3 | -573 | +8 | 11 | 4 | no |
| re2ob-productcatalogservice-disk-3 | 1 | -713 | -713 | 10 | 9 | yes |
| re2ob-productcatalogservice-loss-1 | 6 | -712 | +32 | 12 | 6 | no |
| re2ob-productcatalogservice-loss-2 | 4 | -659 | +40 | 12 | 2 | no |
| re2ob-productcatalogservice-loss-3 | 2 | -714 | -662 | 12 | 7 | no |
| re2ob-productcatalogservice-mem-2 | 1 | -631 | +14 | 10 | 2 | no |
| re2ob-productcatalogservice-mem-3 | 2 | -706 | +11 | 10 | 2 | no |
| re2ob-productcatalogservice-socket-1 | 3 | -715 | +3 | 10 | 4 | no |
| re2ob-productcatalogservice-socket-2 | 2 | -703 | +12 | 9 | 5 | no |
| re2ob-productcatalogservice-socket-3 | 3 | -699 | +9 | 8 | 5 | no |
| re2ob-recommendationservice-cpu-2 | 2 | -702 | +17 | 7 | 4 | no |
| re2ob-recommendationservice-cpu-3 | 2 | -460 | +17 | 6 | 2 | no |
| re2ob-recommendationservice-delay-2 | 3 | -695 | +4 | 7 | 4 | no |
| re2ob-recommendationservice-delay-3 | 2 | -701 | +12 | 8 | 4 | no |
| re2ob-recommendationservice-disk-1 | 8 | -635 | +11 | 8 | 7 | no |
| re2ob-recommendationservice-disk-2 | 4 | -699 | +18 | 7 | 5 | no |
| re2ob-recommendationservice-disk-3 | 3 | -649 | +6 | 7 | 5 | no |
| re2ob-recommendationservice-loss-1 | 2 | -712 | -712 | 12 | 6 | yes |
| re2ob-recommendationservice-loss-2 | 6 | -537 | +20 | 10 | 3 | no |
| re2ob-recommendationservice-loss-3 | 9 | -695 | +19 | 12 | 7 | no |
| re2ob-recommendationservice-mem-2 | 6 | -702 | +15 | 7 | 6 | no |
| re2ob-recommendationservice-mem-3 | 2 | -466 | +4 | 6 | 3 | no |
| re2ob-recommendationservice-socket-1 | 3 | -692 | +9 | 8 | 3 | no |
| re2ob-recommendationservice-socket-2 | 2 | -564 | +13 | 6 | 2 | no |
| re2ob-recommendationservice-socket-3 | 3 | -650 | +14 | 5 | 3 | no |

## Confusion (predicted -> labeled)

- adservice -> checkoutservice
- emailservice -> checkoutservice
- redis -> checkoutservice
- redis -> checkoutservice
- adservice -> checkoutservice
- emailservice -> checkoutservice
- frontend -> checkoutservice
- emailservice -> checkoutservice
- frontend -> checkoutservice
- redis -> checkoutservice
- redis -> checkoutservice
- frontend -> checkoutservice
- redis -> checkoutservice
- redis -> checkoutservice
- checkoutservice -> currencyservice
- checkoutservice -> currencyservice
- checkoutservice -> currencyservice
- paymentservice -> currencyservice
- redis -> currencyservice
- emailservice -> currencyservice
- checkoutservice -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- frontend -> currencyservice
- redis -> currencyservice
- frontend -> currencyservice
- redis -> currencyservice
- checkoutservice -> currencyservice
- redis -> emailservice
- adservice -> emailservice
- frontend -> emailservice
- redis -> emailservice
- redis -> emailservice
- frontend-external -> emailservice
- adservice -> emailservice
- checkoutservice -> emailservice
- checkoutservice -> emailservice
- checkoutservice -> emailservice
- redis -> emailservice
- redis -> emailservice
- paymentservice -> emailservice
- adservice -> emailservice
- redis -> productcatalogservice
- redis -> productcatalogservice
- checkoutservice -> productcatalogservice
- checkoutservice -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- frontend -> productcatalogservice
- checkoutservice -> productcatalogservice
- checkoutservice -> productcatalogservice
- adservice -> productcatalogservice
- redis -> recommendationservice
- redis -> recommendationservice
- redis -> recommendationservice
- redis -> recommendationservice
- redis -> recommendationservice
- redis -> recommendationservice
- redis -> recommendationservice
- frontend -> recommendationservice
- frontend -> recommendationservice
- currencyservice -> recommendationservice
- frontend-external -> recommendationservice
- redis -> recommendationservice
- checkoutservice -> recommendationservice
- redis -> recommendationservice
- redis -> recommendationservice
