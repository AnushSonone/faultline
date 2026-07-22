# M3 local product review checklist

**Branch:** `runtime/m3-event-time-core`  
**PR:** https://github.com/AnushSonone/faultline/pull/1  
**Date:** 2026-07-21  
**Launch:** `make demo` then open http://127.0.0.1:5173

Use this during the manual review. Mark items as you go. Do not redesign in this pass unless something blocks testing.

---

## Launch

- [ ] `make demo` starts API + UI
- [ ] Health check printed
- [ ] Frontend URL printed (`http://127.0.0.1:5173`)
- [ ] Ctrl+C stops both processes (no orphans)

---

## Normal replay

- [ ] Load `rec-mem-001` (automatic on boot)
- [ ] Start replay (Play)
- [ ] Pause
- [ ] Resume (Play again)
- [ ] Change speed (API default is 10x; note if UI speed control is missing)
- [ ] Seek backward (timeline click)
- [ ] Seek forward
- [ ] Reset
- [ ] Reach the end of the incident
- [ ] Replay a second time

---

## Visual synchronization

- [ ] Select a service in the topology
- [ ] Select a heatmap cell
- [ ] Move / click the timeline
- [ ] Open a trace
- [ ] All relevant views share the same incident time
- [ ] Seeking backward does not leave later spans in the waterfall

---

## Streaming heatmap

- [ ] Development status shows `Heatmap: streaming`
- [ ] Runtime inspector `projection_mode` is `streaming`
- [ ] Heatmap cells appear after Play / seek
- [ ] `active_windows` changes during replay
- [ ] `rows_processed` / `batches_processed` increase
- [ ] `global_watermark_ns` advances
- [ ] Toggle to precomputed and compare
- [ ] Toggle back to streaming
- [ ] Parity notes: cells should cover same services/time range; exact values may differ by aggregation semantics

---

## Adversarial replay

- [ ] Click **Adversarial on** (reloads session with shuffled metric arrival)
- [ ] Observe inspector late / beyond-grace counters when seeking through the incident
- [ ] Observe `heatmap_revisions` changing
- [ ] Confirm finalized state is not wildly inconsistent after seek/reset
- [ ] Click **Adversarial off** to return to normal arrival order

---

## Runtime inspector

Confirm visible fields:

- [ ] projection mode
- [ ] global watermark
- [ ] allowed lateness
- [ ] reorder-buffer size
- [ ] active windows
- [ ] finalized windows
- [ ] rows processed
- [ ] batches processed
- [ ] queue depth
- [ ] late-event count
- [ ] beyond-grace count
- [ ] revision count (`heatmap_revisions`)

---

## Product clarity

Answer yes/no + short notes:

| Question | Y/N | Notes |
|----------|-----|-------|
| Is it obvious what incident is occurring? | | |
| Is it obvious which data is synthetic? | | |
| Is it obvious root cause is ground truth, not inferred? | | |
| Is it obvious which view is streaming-powered? | | |
| Does the slider behave predictably? | | |
| Does the graph remain stable? | | |
| Are visual changes noticeable without being noisy? | | |
| Does the runtime inspector explain rather than distract? | | |
| Can a recruiter understand the project in ten seconds? | | |
| Can an engineer understand what changed in M3? | | |

---

## Reviewer notes

### Bugs


### Confusing interactions


### Visual polish issues


### Missing labels


### Performance problems


### Desired changes

