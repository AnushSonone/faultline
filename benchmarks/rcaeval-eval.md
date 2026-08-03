# RCA evaluation (15 incidents, rcaeval-re2-ob/v2 (REAL RCAEval data))

Untuned spec 18.4 weights (train-free):

| metric | value |
|---|---|
| top-1 accuracy | 0.267 |
| top-3 accuracy | 0.467 |
| MRR | 0.407 |

## Per fault type

| fault | top-1 | top-3 | MRR | n |
|---|---|---|---|---|
| cpu | 0.200 | 0.200 | 0.281 | 5 |
| delay | 0.200 | 0.600 | 0.405 | 5 |
| mem | 0.400 | 0.600 | 0.536 | 5 |

## Ablations (component removed)

| ablation | top-1 | top-3 | MRR |
|---|---|---|---|
| no_change_proximity | 0.267 | 0.467 | 0.407 |
| no_critical_path | 0.267 | 0.467 | 0.407 |
| no_failed_trace_coverage | 0.267 | 0.467 | 0.407 |
| no_log_evidence | 0.267 | 0.467 | 0.407 |
| no_temporal_precedence | 0.133 | 0.400 | 0.320 |
| no_topology | 0.067 | 0.400 | 0.291 |

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
