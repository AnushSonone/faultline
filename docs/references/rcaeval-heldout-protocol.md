# RCAEval RE2-OB held-out protocol

This document fixes how Faultline's anomaly detector is measured on RCAEval RE2-OB
before anyone looks at the held-out cases. `scripts/run-rcaeval.sh` enforces the freeze
mechanically; the wording rules below are enforced by review.

## Splits

Case lists and per-case `manifest.json` sha256 pins live in
`datasets/manifests/rcaeval-re2ob-split.yaml`. RE2-OB has 90 cases: 5 services
(checkoutservice, currencyservice, emailservice, productcatalogservice,
recommendationservice) x 6 faults (cpu, mem, disk, delay, loss, socket) x instances 1-3.

| split | fixtures | cases | status |
|---|---|---|---|
| T, tuning | `rcaeval-re2-ob/v2` | 15: instance 1 of cpu/mem/delay per service | in-sample. The 2026-08-03 result and every detector change since were made while looking at these cases. |
| H, held-out | `rcaeval-re2-ob/v2-heldout` | 75: every case not in T | untouched until the freeze |
| H1 | subgroup of H | 30: cpu/mem/delay, instances 2-3 | same fault types as T, new instances |
| H2 | subgroup of H | 45: disk/loss/socket, instances 1-3 | fault types never tuned on |

## Detector presets

The preset name maps to a `FeatureConfig` in exactly one function,
`crates/cli/src/evaluate.rs::detector_config`. Every report's `protocol` block records the
preset name, the full serialized `FeatureConfig`, its sha256, the sha256 of
`RankingWeights::default()` (spec 18.4 weights, unchanged by this work), the dataset path,
incident ids, per-incident manifest sha256, and the git commit with a dirty-file count.

| preset | meaning |
|---|---|
| `legacy` | the detector that produced `benchmarks/rcaeval-eval.json` on 2026-08-03 |
| `v2` | the fixed detector, `FeatureConfig::v2()`, the default after it merges |
| `v2-no-floor` | ablation, `FeatureConfig::v2_no_floor()` |
| `v2-no-persistence` | ablation, `FeatureConfig::v2_no_persistence()` |
| `v2-window32` | ablation, `FeatureConfig::v2_window32()` |

The exact meaning of each v2 preset is whatever its serialized config in the report says.
Ranking ablations (`no_temporal_precedence`, `no_failed_trace_coverage`, `no_topology`,
`no_change_proximity`, `no_log_evidence`, `no_critical_path`) run under every preset.

## Metrics

Per incident, `best_rank` is the 1-based rank of the best-placed labeled root-cause service in
the system's ranked service list, or none when it is absent.

- **top-1, top-3**: fraction of incidents with `best_rank <= 1` or `<= 3`. Reported as k/n with
  a Wilson 95% score interval.
- **MRR**: mean of `1 / best_rank`, 0 when absent.
- **Avg@5**: RCAEval's definition (`RCAEval/benchmark/evaluation.py`, `Evaluator.average` in
  1.6.0): the mean of AC@1 through AC@5, where AC@k is the fraction of incidents with
  `best_rank <= k`. Per incident this is `(6 - best_rank) / 5` for ranks 1-5 and 0 otherwise.
- Reported overall, per fault type, and per subgroup (T, H, H1, H2). Wilson intervals apply to
  top-1 and top-3 only; MRR and Avg@5 carry no interval.
- `python/faultline_data/score_rankings.py` is the single scorer for Faultline and baselines,
  and checks that its Faultline numbers equal the Rust summaries.

### Onset metrics (`evaluate`, per incident `onsets` block)

Offsets are seconds relative to the labeled fault start (`fault_start_time_ns`, RCAEval's
`inject_time`); negative means before the injection. The labels are read only after ranking.

- `incident_onset_ns`, `incident_onset_offset_s`: earliest detector onset across services.
- `service_onset_offset_s`: onset offset for every service with an onset.
- `services_with_onset`, `services_onset_before_fault`: counts; the second counts onsets
  strictly before the fault start, which are false alarms relative to the label.
- `root_cause_onset_offset_s`: earliest onset among the labeled services.
- `root_cause_strictly_earliest`: the labeled service's onset is earlier than every other
  service's. `root_cause_tied_earliest`: it equals the earliest other onset.

### Replay stability (`faultline-cli replay-stability`)

Steps a cursor from the manifest start to end every `--step-s` seconds plus the end cursor,
calling the live `faultline_projection::build_root_causes` at each. That path uses the build's
`FeatureConfig::default()`, so the command refuses a preset that differs from it.

- `first_nonempty_ranking_offset_s`, `first_onset_cursor_offset_s`: first cursor with any
  candidate, and first cursor with any detector onset.
- `top1_changes_after_first_ranking`: consecutive cursor pairs whose top-1 differs.
- `final_top1_first_seen_offset_s`, `final_top1_stable_from_offset_s`: when the end-cursor
  top-1 first appears as top-1, and from when it never changes again.
- `flicker_count`: over consecutive cursor pairs and services, times a service had an onset at
  the earlier cursor and none at the later one. `onset_shift_count`: onset present at both but
  at a different time.
- `last_cursor_call_ms`: wall time of `build_root_causes` at the end cursor, median and
  nearest-rank p95 over repeated calls. Machine dependent; not a headline number.

## Baselines

nsigma and BARO from RCAEval 1.6.0 (`python/.venv-baselines`, pins in
`python/baselines-requirements.txt`), run by `python/faultline_data/baselines/rcaeval.py` with
the same preprocessing RCAEval's own `main.py` applies to RE2-OB: drop `_latency-50`, forward
fill, 600 s before and 600 s after `inject_time`, `_latency-90` renamed to `_latency`,
`dataset="re2-ob"`, coarse-grained service collapse.

**The baselines receive the labeled injection time. Faultline does not; it must detect the
onset itself.** Every baseline output and summary states this.

Input source: RCAEval's `main.py` reads `data.csv`, falling back to `simple_metrics.csv`, which
is what the Zenodo RE2-OB.zip ships. Our raw cases come from the Figshare RCAEval-v2 archive,
which stores the same table as `metrics.json`; the runner rebuilds the table from it and
records the input source per case. On the 15 tuning cases the Zenodo `simple_metrics.csv` and
our `metrics.json` agree on every column, column order, value, and inject time, and both
sources give identical nsigma and BARO rankings.

The baseline numbers in RESULTS.md (2026-08-03) were not produced with RCAEval's protocol: they
kept the `_latency-50` columns and used the full recording instead of 600 s either side of the
injection. `--variant results-2026-08-03` reproduces them exactly on T; it exists only to
reconcile that record. The harness default and every held-out baseline use `rcaeval-main`.

## Freeze rule

1. Nothing touches H before the freeze: no `evaluate`, no baselines, no `replay-stability`, no
   scoring, and no reading of H metric values. Converting H and pinning its manifest sha256
   values is allowed.
2. The freeze is a commit. The main thread records it below as `frozen_commit:` and commits
   that edit. Detector presets, ranking weights, the scorer, and the harness are final at that
   commit.
3. `scripts/run-rcaeval.sh --split heldout` refuses to run unless: `frozen_commit:` holds a
   commit, `git diff --quiet HEAD -- crates apps` passes with no untracked files there, HEAD is
   the frozen commit or a descendant, and the H fixtures match the split manifest ids and
   sha256 values. Freeze checks run before any H fixture is opened.
4. H is run once per frozen commit, every requested preset plus baselines, and the outputs are
   committed as produced. No preset is dropped or re-run selectively after seeing H.
5. Anything changed after seeing H results (detector, presets, weights, ranking, scoring) is a
   new preset `v3`. For `v3`, H counts as tuning data: no held-out claim for `v3` on H.

## Claim wording

- The held-out number is the headline. Tuning numbers appear only beside held-out numbers and
  are labeled in-sample.
- Always give k/n and the Wilson 95% interval with top-1 and top-3 on H, and name the split.
- Never call v2 as a whole "untuned": its detector was changed while looking at T. "Ranking
  weights unchanged from spec 18.4" is accurate and allowed.
- Never write "validated", "generalizes", or parity wording ("on par with", "matches",
  "comparable to", "competitive with") about Faultline versus baselines. State both numbers
  with intervals and note that the baselines receive the injection time.
- H2 results are reported separately from H1, since H2 fault types were never tuned on.

Example of allowed wording: "On the 75 held-out RE2-OB cases, Faultline v2 ranks the labeled
root cause first in k/75 (p, 95% CI [lo, hi]); in-sample on the 15 tuning cases it is k/15.
RCAEval's nsigma, which is given the injection time, ranks it first in k/75."

## Freeze record

frozen_commit:
