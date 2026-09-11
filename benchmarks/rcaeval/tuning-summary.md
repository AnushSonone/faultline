# RCAEval RE2-OB tuning split T (15 cases, in-sample)

Note: nsigma and BARO receive the labeled injection time and compare the window before it with the window after it. Faultline receives no injection time and detects the onset itself.

Metrics: best rank of the labeled root-cause service in each system's ranked service list. Avg@5 is RCAEval's mean of AC@1..AC@5. Wilson intervals apply to the proportions only; MRR and Avg@5 carry no interval here.

## Overall

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 4/15 = 0.267 [0.109, 0.520] | 7/15 = 0.467 [0.248, 0.699] | 0.407 | 0.413 |
| faultline-v2 | 11/15 = 0.733 [0.480, 0.891] | 15/15 = 1.000 [0.796, 1.000] | 0.844 | 0.920 |
| faultline-v2-no-floor | 2/15 = 0.133 [0.037, 0.379] | 5/15 = 0.333 [0.152, 0.583] | 0.305 | 0.280 |
| faultline-v2-no-persistence | 2/15 = 0.133 [0.037, 0.379] | 9/15 = 0.600 [0.357, 0.802] | 0.403 | 0.533 |
| faultline-v2-window32 | 3/15 = 0.200 [0.070, 0.452] | 4/15 = 0.267 [0.109, 0.520] | 0.348 | 0.360 |
| rcaeval-nsigma | 11/15 = 0.733 [0.480, 0.891] | 14/15 = 0.933 [0.702, 0.988] | 0.824 | 0.880 |
| rcaeval-baro | 2/15 = 0.133 [0.037, 0.379] | 12/15 = 0.800 [0.548, 0.930] | 0.510 | 0.720 |
| rcaeval-nsigma [results-2026-08-03 variant] | 14/15 = 0.933 [0.702, 0.988] | 14/15 = 0.933 [0.702, 0.988] | 0.950 | 0.960 |
| rcaeval-baro [results-2026-08-03 variant] | 2/15 = 0.133 [0.037, 0.379] | 14/15 = 0.933 [0.702, 0.988] | 0.524 | 0.760 |

## Subgroup tuning

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 4/15 = 0.267 [0.109, 0.520] | 7/15 = 0.467 [0.248, 0.699] | 0.407 | 0.413 |
| faultline-v2 | 11/15 = 0.733 [0.480, 0.891] | 15/15 = 1.000 [0.796, 1.000] | 0.844 | 0.920 |
| faultline-v2-no-floor | 2/15 = 0.133 [0.037, 0.379] | 5/15 = 0.333 [0.152, 0.583] | 0.305 | 0.280 |
| faultline-v2-no-persistence | 2/15 = 0.133 [0.037, 0.379] | 9/15 = 0.600 [0.357, 0.802] | 0.403 | 0.533 |
| faultline-v2-window32 | 3/15 = 0.200 [0.070, 0.452] | 4/15 = 0.267 [0.109, 0.520] | 0.348 | 0.360 |
| rcaeval-nsigma | 11/15 = 0.733 [0.480, 0.891] | 14/15 = 0.933 [0.702, 0.988] | 0.824 | 0.880 |
| rcaeval-baro | 2/15 = 0.133 [0.037, 0.379] | 12/15 = 0.800 [0.548, 0.930] | 0.510 | 0.720 |
| rcaeval-nsigma [results-2026-08-03 variant] | 14/15 = 0.933 [0.702, 0.988] | 14/15 = 0.933 [0.702, 0.988] | 0.950 | 0.960 |
| rcaeval-baro [results-2026-08-03 variant] | 2/15 = 0.133 [0.037, 0.379] | 14/15 = 0.933 [0.702, 0.988] | 0.524 | 0.760 |

## Fault type cpu

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 1/5 = 0.200 [0.036, 0.624] | 1/5 = 0.200 [0.036, 0.624] | 0.281 | 0.200 |
| faultline-v2 | 4/5 = 0.800 [0.376, 0.964] | 5/5 = 1.000 [0.566, 1.000] | 0.900 | 0.960 |
| faultline-v2-no-floor | 1/5 = 0.200 [0.036, 0.624] | 2/5 = 0.400 [0.118, 0.769] | 0.337 | 0.320 |
| faultline-v2-no-persistence | 2/5 = 0.400 [0.118, 0.769] | 3/5 = 0.600 [0.231, 0.882] | 0.600 | 0.720 |
| faultline-v2-window32 | 0/5 = 0.000 [0.000, 0.434] | 1/5 = 0.200 [0.036, 0.624] | 0.192 | 0.200 |
| rcaeval-nsigma | 4/5 = 0.800 [0.376, 0.964] | 4/5 = 0.800 [0.376, 0.964] | 0.840 | 0.840 |
| rcaeval-baro | 0/5 = 0.000 [0.000, 0.434] | 4/5 = 0.800 [0.376, 0.964] | 0.429 | 0.640 |
| rcaeval-nsigma [results-2026-08-03 variant] | 5/5 = 1.000 [0.566, 1.000] | 5/5 = 1.000 [0.566, 1.000] | 1.000 | 1.000 |
| rcaeval-baro [results-2026-08-03 variant] | 0/5 = 0.000 [0.000, 0.434] | 5/5 = 1.000 [0.566, 1.000] | 0.467 | 0.760 |

## Fault type delay

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 1/5 = 0.200 [0.036, 0.624] | 3/5 = 0.600 [0.231, 0.882] | 0.405 | 0.480 |
| faultline-v2 | 3/5 = 0.600 [0.231, 0.882] | 5/5 = 1.000 [0.566, 1.000] | 0.733 | 0.840 |
| faultline-v2-no-floor | 0/5 = 0.000 [0.000, 0.434] | 1/5 = 0.200 [0.036, 0.624] | 0.170 | 0.120 |
| faultline-v2-no-persistence | 0/5 = 0.000 [0.000, 0.434] | 2/5 = 0.400 [0.118, 0.769] | 0.269 | 0.320 |
| faultline-v2-window32 | 1/5 = 0.200 [0.036, 0.624] | 1/5 = 0.200 [0.036, 0.624] | 0.342 | 0.360 |
| rcaeval-nsigma | 3/5 = 0.600 [0.231, 0.882] | 5/5 = 1.000 [0.566, 1.000] | 0.733 | 0.840 |
| rcaeval-baro | 0/5 = 0.000 [0.000, 0.434] | 3/5 = 0.600 [0.231, 0.882] | 0.400 | 0.640 |
| rcaeval-nsigma [results-2026-08-03 variant] | 4/5 = 0.800 [0.376, 0.964] | 4/5 = 0.800 [0.376, 0.964] | 0.850 | 0.880 |
| rcaeval-baro [results-2026-08-03 variant] | 0/5 = 0.000 [0.000, 0.434] | 4/5 = 0.800 [0.376, 0.964] | 0.407 | 0.640 |

## Fault type mem

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 2/5 = 0.400 [0.118, 0.769] | 3/5 = 0.600 [0.231, 0.882] | 0.536 | 0.560 |
| faultline-v2 | 4/5 = 0.800 [0.376, 0.964] | 5/5 = 1.000 [0.566, 1.000] | 0.900 | 0.960 |
| faultline-v2-no-floor | 1/5 = 0.200 [0.036, 0.624] | 2/5 = 0.400 [0.118, 0.769] | 0.407 | 0.400 |
| faultline-v2-no-persistence | 0/5 = 0.000 [0.000, 0.434] | 4/5 = 0.800 [0.376, 0.964] | 0.340 | 0.560 |
| faultline-v2-window32 | 2/5 = 0.400 [0.118, 0.769] | 2/5 = 0.400 [0.118, 0.769] | 0.510 | 0.520 |
| rcaeval-nsigma | 4/5 = 0.800 [0.376, 0.964] | 5/5 = 1.000 [0.566, 1.000] | 0.900 | 0.960 |
| rcaeval-baro | 2/5 = 0.400 [0.118, 0.769] | 5/5 = 1.000 [0.566, 1.000] | 0.700 | 0.880 |
| rcaeval-nsigma [results-2026-08-03 variant] | 5/5 = 1.000 [0.566, 1.000] | 5/5 = 1.000 [0.566, 1.000] | 1.000 | 1.000 |
| rcaeval-baro [results-2026-08-03 variant] | 2/5 = 0.400 [0.118, 0.769] | 5/5 = 1.000 [0.566, 1.000] | 0.700 | 0.880 |

## Scorer versus Rust summary

- faultline-legacy (tuning-legacy.json): equal
- faultline-v2 (tuning-v2.json): equal
- faultline-v2-no-floor (tuning-v2-no-floor.json): equal
- faultline-v2-no-persistence (tuning-v2-no-persistence.json): equal
- faultline-v2-window32 (tuning-v2-window32.json): equal

## Best rank per case

| case | faultline-legacy | faultline-v2 | faultline-v2-no-floor | faultline-v2-no-persistence | faultline-v2-window32 | rcaeval-nsigma | rcaeval-baro | rcaeval-nsigma [results-2026-08-03 variant] | rcaeval-baro [results-2026-08-03 variant] |
|---|---|---|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-1 | 9 | 1 | 3 | 2 | 3 | 1 | 2 | 1 | 2 |
| re2ob-checkoutservice-delay-1 | 2 | 3 | 8 | 3 | 4 | 3 | 4 | 4 | 5 |
| re2ob-checkoutservice-mem-1 | 1 | 1 | 6 | 3 | 1 | 1 | 2 | 1 | 2 |
| re2ob-currencyservice-cpu-1 | 1 | 1 | 1 | 1 | 4 | 5 | 7 | 1 | 2 |
| re2ob-currencyservice-delay-1 | 1 | 1 | 3 | 6 | 4 | 3 | 4 | 1 | 2 |
| re2ob-currencyservice-mem-1 | 11 | 1 | 6 | 5 | 4 | 2 | 2 | 1 | 2 |
| re2ob-emailservice-cpu-1 | 12 | 1 | 10 | 4 | 6 | 1 | 2 | 1 | 3 |
| re2ob-emailservice-delay-1 | 3 | 1 | 8 | 2 | 1 | 1 | 2 | 1 | 3 |
| re2ob-emailservice-mem-1 | 11 | 1 | 5 | 3 | 5 | 1 | 1 | 1 | 1 |
| re2ob-productcatalogservice-cpu-1 | 8 | 2 | 9 | 1 | 9 | 1 | 2 | 1 | 2 |
| re2ob-productcatalogservice-delay-1 | 11 | 3 | 7 | 7 | 9 | 1 | 2 | 1 | 2 |
| re2ob-productcatalogservice-mem-1 | 1 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 |
| re2ob-recommendationservice-cpu-1 | 12 | 1 | 7 | 4 | 10 | 1 | 2 | 1 | 2 |
| re2ob-recommendationservice-delay-1 | 10 | 1 | 8 | 5 | 10 | 1 | 2 | 1 | 2 |
| re2ob-recommendationservice-mem-1 | 2 | 1 | 1 | 3 | 10 | 1 | 2 | 1 | 2 |
