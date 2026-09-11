# RCAEval RE2-OB held-out split H (75 cases)

Note: nsigma and BARO receive the labeled injection time and compare the window before it with the window after it. Faultline receives no injection time and detects the onset itself.

Metrics: best rank of the labeled root-cause service in each system's ranked service list. Avg@5 is RCAEval's mean of AC@1..AC@5. Wilson intervals apply to the proportions only; MRR and Avg@5 carry no interval here.

## Overall

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 12/75 = 0.160 [0.094, 0.259] | 27/75 = 0.360 [0.261, 0.473] | 0.336 | 0.352 |
| faultline-v2 | 58/75 = 0.773 [0.667, 0.853] | 73/75 = 0.973 [0.908, 0.993] | 0.867 | 0.928 |
| faultline-v2-no-floor | 9/75 = 0.120 [0.064, 0.213] | 24/75 = 0.320 [0.225, 0.432] | 0.308 | 0.325 |
| faultline-v2-no-persistence | 7/75 = 0.093 [0.046, 0.180] | 45/75 = 0.600 [0.487, 0.703] | 0.378 | 0.493 |
| faultline-v2-window32 | 13/75 = 0.173 [0.104, 0.274] | 29/75 = 0.387 [0.285, 0.500] | 0.354 | 0.403 |
| rcaeval-nsigma | 60/75 = 0.800 [0.696, 0.875] | 71/75 = 0.947 [0.871, 0.979] | 0.877 | 0.917 |
| rcaeval-baro | 11/75 = 0.147 [0.084, 0.244] | 67/75 = 0.893 [0.803, 0.945] | 0.529 | 0.747 |

## Subgroup heldout

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 12/75 = 0.160 [0.094, 0.259] | 27/75 = 0.360 [0.261, 0.473] | 0.336 | 0.352 |
| faultline-v2 | 58/75 = 0.773 [0.667, 0.853] | 73/75 = 0.973 [0.908, 0.993] | 0.867 | 0.928 |
| faultline-v2-no-floor | 9/75 = 0.120 [0.064, 0.213] | 24/75 = 0.320 [0.225, 0.432] | 0.308 | 0.325 |
| faultline-v2-no-persistence | 7/75 = 0.093 [0.046, 0.180] | 45/75 = 0.600 [0.487, 0.703] | 0.378 | 0.493 |
| faultline-v2-window32 | 13/75 = 0.173 [0.104, 0.274] | 29/75 = 0.387 [0.285, 0.500] | 0.354 | 0.403 |
| rcaeval-nsigma | 60/75 = 0.800 [0.696, 0.875] | 71/75 = 0.947 [0.871, 0.979] | 0.877 | 0.917 |
| rcaeval-baro | 11/75 = 0.147 [0.084, 0.244] | 67/75 = 0.893 [0.803, 0.945] | 0.529 | 0.747 |

## Subgroup heldout_h1

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 6/30 = 0.200 [0.095, 0.373] | 12/30 = 0.400 [0.246, 0.577] | 0.366 | 0.373 |
| faultline-v2 | 28/30 = 0.933 [0.787, 0.982] | 30/30 = 1.000 [0.886, 1.000] | 0.967 | 0.987 |
| faultline-v2-no-floor | 6/30 = 0.200 [0.095, 0.373] | 10/30 = 0.333 [0.192, 0.512] | 0.364 | 0.373 |
| faultline-v2-no-persistence | 4/30 = 0.133 [0.053, 0.297] | 21/30 = 0.700 [0.521, 0.833] | 0.436 | 0.567 |
| faultline-v2-window32 | 5/30 = 0.167 [0.073, 0.336] | 12/30 = 0.400 [0.246, 0.577] | 0.364 | 0.440 |
| rcaeval-nsigma | 24/30 = 0.800 [0.627, 0.905] | 28/30 = 0.933 [0.787, 0.982] | 0.874 | 0.913 |
| rcaeval-baro | 3/30 = 0.100 [0.035, 0.256] | 27/30 = 0.900 [0.744, 0.965] | 0.501 | 0.727 |

## Subgroup heldout_h2

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 6/45 = 0.133 [0.063, 0.262] | 15/45 = 0.333 [0.214, 0.479] | 0.316 | 0.338 |
| faultline-v2 | 30/45 = 0.667 [0.521, 0.786] | 43/45 = 0.956 [0.852, 0.988] | 0.800 | 0.889 |
| faultline-v2-no-floor | 3/45 = 0.067 [0.023, 0.179] | 14/45 = 0.311 [0.195, 0.457] | 0.271 | 0.293 |
| faultline-v2-no-persistence | 3/45 = 0.067 [0.023, 0.179] | 24/45 = 0.533 [0.391, 0.671] | 0.340 | 0.444 |
| faultline-v2-window32 | 8/45 = 0.178 [0.093, 0.313] | 17/45 = 0.378 [0.251, 0.524] | 0.347 | 0.378 |
| rcaeval-nsigma | 36/45 = 0.800 [0.662, 0.891] | 43/45 = 0.956 [0.852, 0.988] | 0.879 | 0.920 |
| rcaeval-baro | 8/45 = 0.178 [0.093, 0.313] | 40/45 = 0.889 [0.765, 0.952] | 0.548 | 0.760 |

## Fault type cpu

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 2/10 = 0.200 [0.057, 0.510] | 4/10 = 0.400 [0.168, 0.687] | 0.361 | 0.380 |
| faultline-v2 | 10/10 = 1.000 [0.722, 1.000] | 10/10 = 1.000 [0.722, 1.000] | 1.000 | 1.000 |
| faultline-v2-no-floor | 3/10 = 0.300 [0.108, 0.603] | 5/10 = 0.500 [0.237, 0.763] | 0.437 | 0.440 |
| faultline-v2-no-persistence | 1/10 = 0.100 [0.018, 0.404] | 5/10 = 0.500 [0.237, 0.763] | 0.371 | 0.440 |
| faultline-v2-window32 | 1/10 = 0.100 [0.018, 0.404] | 2/10 = 0.200 [0.057, 0.510] | 0.279 | 0.320 |
| rcaeval-nsigma | 7/10 = 0.700 [0.397, 0.892] | 8/10 = 0.800 [0.490, 0.943] | 0.790 | 0.820 |
| rcaeval-baro | 0/10 = 0.000 [0.000, 0.278] | 8/10 = 0.800 [0.490, 0.943] | 0.420 | 0.640 |

## Fault type delay

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 2/10 = 0.200 [0.057, 0.510] | 3/10 = 0.300 [0.108, 0.603] | 0.307 | 0.260 |
| faultline-v2 | 10/10 = 1.000 [0.722, 1.000] | 10/10 = 1.000 [0.722, 1.000] | 1.000 | 1.000 |
| faultline-v2-no-floor | 1/10 = 0.100 [0.018, 0.404] | 1/10 = 0.100 [0.018, 0.404] | 0.242 | 0.200 |
| faultline-v2-no-persistence | 1/10 = 0.100 [0.018, 0.404] | 7/10 = 0.700 [0.397, 0.892] | 0.387 | 0.520 |
| faultline-v2-window32 | 2/10 = 0.200 [0.057, 0.510] | 3/10 = 0.300 [0.108, 0.603] | 0.376 | 0.420 |
| rcaeval-nsigma | 7/10 = 0.700 [0.397, 0.892] | 10/10 = 1.000 [0.722, 1.000] | 0.833 | 0.920 |
| rcaeval-baro | 0/10 = 0.000 [0.000, 0.278] | 9/10 = 0.900 [0.596, 0.982] | 0.433 | 0.680 |

## Fault type disk

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 4/15 = 0.267 [0.109, 0.520] | 6/15 = 0.400 [0.198, 0.643] | 0.382 | 0.373 |
| faultline-v2 | 12/15 = 0.800 [0.548, 0.930] | 15/15 = 1.000 [0.796, 1.000] | 0.878 | 0.933 |
| faultline-v2-no-floor | 3/15 = 0.200 [0.070, 0.452] | 6/15 = 0.400 [0.198, 0.643] | 0.351 | 0.333 |
| faultline-v2-no-persistence | 2/15 = 0.133 [0.037, 0.379] | 8/15 = 0.533 [0.301, 0.752] | 0.374 | 0.467 |
| faultline-v2-window32 | 5/15 = 0.333 [0.152, 0.583] | 9/15 = 0.600 [0.357, 0.802] | 0.489 | 0.533 |
| rcaeval-nsigma | 14/15 = 0.933 [0.702, 0.988] | 15/15 = 1.000 [0.796, 1.000] | 0.967 | 0.987 |
| rcaeval-baro | 2/15 = 0.133 [0.037, 0.379] | 15/15 = 1.000 [0.796, 1.000] | 0.556 | 0.813 |

## Fault type loss

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 0/15 = 0.000 [0.000, 0.204] | 5/15 = 0.333 [0.152, 0.583] | 0.269 | 0.347 |
| faultline-v2 | 3/15 = 0.200 [0.070, 0.452] | 13/15 = 0.867 [0.621, 0.963] | 0.522 | 0.733 |
| faultline-v2-no-floor | 0/15 = 0.000 [0.000, 0.204] | 5/15 = 0.333 [0.152, 0.583] | 0.265 | 0.347 |
| faultline-v2-no-persistence | 0/15 = 0.000 [0.000, 0.204] | 7/15 = 0.467 [0.248, 0.699] | 0.301 | 0.387 |
| faultline-v2-window32 | 2/15 = 0.133 [0.037, 0.379] | 5/15 = 0.333 [0.152, 0.583] | 0.309 | 0.333 |
| rcaeval-nsigma | 10/15 = 0.667 [0.417, 0.848] | 15/15 = 1.000 [0.796, 1.000] | 0.811 | 0.907 |
| rcaeval-baro | 6/15 = 0.400 [0.198, 0.643] | 13/15 = 0.867 [0.621, 0.963] | 0.652 | 0.800 |

## Fault type mem

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 2/10 = 0.200 [0.057, 0.510] | 5/10 = 0.500 [0.237, 0.763] | 0.428 | 0.480 |
| faultline-v2 | 8/10 = 0.800 [0.490, 0.943] | 10/10 = 1.000 [0.722, 1.000] | 0.900 | 0.960 |
| faultline-v2-no-floor | 2/10 = 0.200 [0.057, 0.510] | 4/10 = 0.400 [0.168, 0.687] | 0.412 | 0.480 |
| faultline-v2-no-persistence | 2/10 = 0.200 [0.057, 0.510] | 9/10 = 0.900 [0.596, 0.982] | 0.550 | 0.740 |
| faultline-v2-window32 | 2/10 = 0.200 [0.057, 0.510] | 7/10 = 0.700 [0.397, 0.892] | 0.437 | 0.580 |
| rcaeval-nsigma | 10/10 = 1.000 [0.722, 1.000] | 10/10 = 1.000 [0.722, 1.000] | 1.000 | 1.000 |
| rcaeval-baro | 3/10 = 0.300 [0.108, 0.603] | 10/10 = 1.000 [0.722, 1.000] | 0.650 | 0.860 |

## Fault type socket

| system | top-1 (k/n, Wilson 95%) | top-3 (k/n, Wilson 95%) | MRR | Avg@5 |
|---|---|---|---|---|
| faultline-legacy | 2/15 = 0.133 [0.037, 0.379] | 4/15 = 0.267 [0.109, 0.520] | 0.297 | 0.293 |
| faultline-v2 | 15/15 = 1.000 [0.796, 1.000] | 15/15 = 1.000 [0.796, 1.000] | 1.000 | 1.000 |
| faultline-v2-no-floor | 0/15 = 0.000 [0.000, 0.204] | 3/15 = 0.200 [0.070, 0.452] | 0.198 | 0.200 |
| faultline-v2-no-persistence | 1/15 = 0.067 [0.012, 0.298] | 9/15 = 0.600 [0.357, 0.802] | 0.346 | 0.480 |
| faultline-v2-window32 | 1/15 = 0.067 [0.012, 0.298] | 3/15 = 0.200 [0.070, 0.452] | 0.243 | 0.267 |
| rcaeval-nsigma | 12/15 = 0.800 [0.548, 0.930] | 13/15 = 0.867 [0.621, 0.963] | 0.858 | 0.867 |
| rcaeval-baro | 0/15 = 0.000 [0.000, 0.204] | 12/15 = 0.800 [0.548, 0.930] | 0.436 | 0.667 |

## Scorer versus Rust summary

- faultline-legacy (heldout-legacy.json): equal
- faultline-v2 (heldout-v2.json): equal
- faultline-v2-no-floor (heldout-v2-no-floor.json): equal
- faultline-v2-no-persistence (heldout-v2-no-persistence.json): equal
- faultline-v2-window32 (heldout-v2-window32.json): equal

## Best rank per case

| case | faultline-legacy | faultline-v2 | faultline-v2-no-floor | faultline-v2-no-persistence | faultline-v2-window32 | rcaeval-nsigma | rcaeval-baro |
|---|---|---|---|---|---|---|---|
| re2ob-checkoutservice-cpu-2 | 8 | 1 | 12 | 1 | 4 | 1 | 2 |
| re2ob-checkoutservice-cpu-3 | 3 | 1 | 3 | 3 | 3 | 2 | 3 |
| re2ob-checkoutservice-delay-2 | 11 | 1 | 10 | 6 | 4 | 3 | 3 |
| re2ob-checkoutservice-delay-3 | 6 | 1 | 4 | 3 | 4 | 2 | 3 |
| re2ob-checkoutservice-disk-1 | 3 | 1 | 9 | 3 | 3 | 1 | 2 |
| re2ob-checkoutservice-disk-2 | 3 | 1 | 2 | 2 | 3 | 1 | 2 |
| re2ob-checkoutservice-disk-3 | 4 | 1 | 6 | 2 | 3 | 1 | 2 |
| re2ob-checkoutservice-loss-1 | 7 | 1 | 3 | 3 | 5 | 1 | 2 |
| re2ob-checkoutservice-loss-2 | 2 | 1 | 2 | 2 | 3 | 2 | 3 |
| re2ob-checkoutservice-loss-3 | 2 | 3 | 10 | 2 | 3 | 2 | 2 |
| re2ob-checkoutservice-mem-2 | 4 | 1 | 10 | 3 | 3 | 1 | 2 |
| re2ob-checkoutservice-mem-3 | 10 | 1 | 7 | 2 | 3 | 1 | 2 |
| re2ob-checkoutservice-socket-1 | 11 | 1 | 9 | 6 | 1 | 1 | 2 |
| re2ob-checkoutservice-socket-2 | 12 | 1 | 11 | 3 | 3 | 1 | 2 |
| re2ob-checkoutservice-socket-3 | 7 | 1 | 4 | 3 | 3 | 1 | 2 |
| re2ob-currencyservice-cpu-2 | 1 | 1 | 1 | 6 | 4 | 5 | 5 |
| re2ob-currencyservice-cpu-3 | 1 | 1 | 6 | 8 | 4 | 5 | 6 |
| re2ob-currencyservice-delay-2 | 12 | 1 | 8 | 5 | 4 | 1 | 2 |
| re2ob-currencyservice-delay-3 | 10 | 1 | 8 | 2 | 5 | 2 | 2 |
| re2ob-currencyservice-disk-1 | 12 | 1 | 9 | 7 | 4 | 1 | 2 |
| re2ob-currencyservice-disk-2 | 1 | 3 | 9 | 7 | 6 | 2 | 3 |
| re2ob-currencyservice-disk-3 | 12 | 1 | 10 | 6 | 1 | 1 | 2 |
| re2ob-currencyservice-loss-1 | 3 | 2 | 9 | 6 | 6 | 1 | 2 |
| re2ob-currencyservice-loss-2 | 3 | 3 | 2 | 7 | 5 | 3 | 4 |
| re2ob-currencyservice-loss-3 | 4 | 3 | 4 | 7 | 4 | 3 | 5 |
| re2ob-currencyservice-mem-2 | 1 | 1 | 1 | 2 | 4 | 1 | 2 |
| re2ob-currencyservice-mem-3 | 6 | 2 | 4 | 2 | 2 | 1 | 2 |
| re2ob-currencyservice-socket-1 | 2 | 1 | 9 | 6 | 4 | 2 | 4 |
| re2ob-currencyservice-socket-2 | 3 | 1 | 2 | 1 | 4 | 6 | 7 |
| re2ob-currencyservice-socket-3 | 1 | 1 | 11 | 5 | 4 | 5 | 7 |
| re2ob-emailservice-cpu-2 | 8 | 1 | 10 | 6 | 5 | 1 | 2 |
| re2ob-emailservice-cpu-3 | 12 | 1 | 11 | 2 | 1 | 1 | 2 |
| re2ob-emailservice-delay-2 | 12 | 1 | 1 | 3 | 1 | 1 | 6 |
| re2ob-emailservice-delay-3 | 11 | 1 | 4 | 3 | 1 | 1 | 2 |
| re2ob-emailservice-disk-1 | 12 | 1 | 8 | 5 | 1 | 1 | 2 |
| re2ob-emailservice-disk-2 | 12 | 1 | 9 | 3 | 1 | 1 | 1 |
| re2ob-emailservice-disk-3 | 11 | 2 | 7 | 4 | 2 | 1 | 1 |
| re2ob-emailservice-loss-1 | 8 | 1 | 6 | 2 | 1 | 1 | 2 |
| re2ob-emailservice-loss-2 | 7 | 4 | 5 | 5 | 9 | 1 | 2 |
| re2ob-emailservice-loss-3 | 7 | 2 | 5 | 3 | 8 | 1 | 2 |
| re2ob-emailservice-mem-2 | 8 | 1 | 8 | 1 | 1 | 1 | 1 |
| re2ob-emailservice-mem-3 | 2 | 1 | 2 | 2 | 5 | 1 | 1 |
| re2ob-emailservice-socket-1 | 12 | 1 | 8 | 4 | 5 | 1 | 2 |
| re2ob-emailservice-socket-2 | 5 | 1 | 2 | 5 | 5 | 1 | 2 |
| re2ob-emailservice-socket-3 | 6 | 1 | 10 | 5 | 5 | 1 | 2 |
| re2ob-productcatalogservice-cpu-2 | 12 | 1 | 1 | 4 | 5 | 1 | 2 |
| re2ob-productcatalogservice-cpu-3 | 2 | 1 | 2 | 6 | 9 | 1 | 2 |
| re2ob-productcatalogservice-delay-2 | 1 | 1 | 7 | 6 | 2 | 1 | 2 |
| re2ob-productcatalogservice-delay-3 | 1 | 1 | 5 | 1 | 9 | 1 | 2 |
| re2ob-productcatalogservice-disk-1 | 1 | 1 | 3 | 1 | 9 | 1 | 2 |
| re2ob-productcatalogservice-disk-2 | 1 | 1 | 1 | 3 | 9 | 1 | 2 |
| re2ob-productcatalogservice-disk-3 | 1 | 3 | 1 | 1 | 1 | 1 | 2 |
| re2ob-productcatalogservice-loss-1 | 4 | 2 | 4 | 6 | 3 | 1 | 1 |
| re2ob-productcatalogservice-loss-2 | 5 | 3 | 5 | 4 | 1 | 1 | 1 |
| re2ob-productcatalogservice-loss-3 | 2 | 4 | 2 | 2 | 4 | 2 | 1 |
| re2ob-productcatalogservice-mem-2 | 1 | 1 | 1 | 1 | 3 | 1 | 1 |
| re2ob-productcatalogservice-mem-3 | 2 | 2 | 4 | 2 | 3 | 1 | 2 |
| re2ob-productcatalogservice-socket-1 | 8 | 1 | 6 | 3 | 9 | 1 | 2 |
| re2ob-productcatalogservice-socket-2 | 5 | 1 | 10 | 2 | 10 | 1 | 2 |
| re2ob-productcatalogservice-socket-3 | 1 | 1 | 10 | 3 | 9 | 1 | 2 |
| re2ob-recommendationservice-cpu-2 | 4 | 1 | 1 | 2 | 10 | 1 | 2 |
| re2ob-recommendationservice-cpu-3 | 9 | 1 | 10 | 2 | 10 | 1 | 2 |
| re2ob-recommendationservice-delay-2 | 8 | 1 | 9 | 3 | 10 | 1 | 2 |
| re2ob-recommendationservice-delay-3 | 3 | 1 | 9 | 2 | 10 | 1 | 2 |
| re2ob-recommendationservice-disk-1 | 8 | 1 | 1 | 8 | 1 | 1 | 2 |
| re2ob-recommendationservice-disk-2 | 10 | 1 | 3 | 4 | 10 | 1 | 2 |
| re2ob-recommendationservice-disk-3 | 6 | 1 | 8 | 3 | 10 | 1 | 2 |
| re2ob-recommendationservice-loss-1 | 4 | 2 | 3 | 2 | 7 | 1 | 1 |
| re2ob-recommendationservice-loss-2 | 5 | 2 | 5 | 6 | 11 | 1 | 1 |
| re2ob-recommendationservice-loss-3 | 6 | 2 | 8 | 9 | 10 | 1 | 1 |
| re2ob-recommendationservice-mem-2 | 7 | 1 | 4 | 6 | 11 | 1 | 2 |
| re2ob-recommendationservice-mem-3 | 2 | 1 | 2 | 2 | 1 | 1 | 2 |
| re2ob-recommendationservice-socket-1 | 4 | 1 | 3 | 3 | 10 | 1 | 2 |
| re2ob-recommendationservice-socket-2 | 12 | 1 | 7 | 2 | 10 | 1 | 2 |
| re2ob-recommendationservice-socket-3 | 5 | 1 | 4 | 3 | 10 | 1 | 2 |
