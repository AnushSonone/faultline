# ADR 0013: Window revision semantics

Window emits carry stable `window_id` and monotonic `revision`. Late revisable events may bump revision; beyond-grace events are counted and do not mutate finalized state after grace expiry. Frontend replaces by window/revision rather than appending duplicates.
