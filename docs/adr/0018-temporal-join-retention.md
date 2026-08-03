# ADR 0018: Temporal join retention

**Status:** Accepted  
**Date:** 2026-07-21

Left and right state rows are retained until:

```text
event_time < watermark - (interval_side + late_grace)
```

Expired rows increment `expired_rows` and are removed. Duplicate `(change_id, event_id)` pairs are ignored.
