import type { TraceSummary } from "../../types/protocol";
import { shortTraceId } from "../../lib/format";

type Props = {
  listed: TraceSummary[];
  failedIds: string[];
  selected: string | null;
  onSelect: (id: string) => void;
};

// The trace picker: a native select with the failed traces (from the top
// candidate's failed_trace_ids) grouped first, then every trace listed at
// the cursor. Option text is the short id and the span count.
// Real cases list thousands of traces at the cursor; the option list is
// capped so the select stays responsive, keeping the selection listed.
const MAX_OPTIONS = 300;

export function TracePicker({ listed, failedIds, selected, onSelect }: Props) {
  const failedSet = new Set(failedIds);
  const failed = listed.filter((t) => failedSet.has(t.trace_id));
  const shown =
    listed.length <= MAX_OPTIONS
      ? listed
      : [...listed.slice(0, MAX_OPTIONS), ...listed.slice(MAX_OPTIONS).filter((t) => t.trace_id === selected)];
  const label = (t: TraceSummary) =>
    `${shortTraceId(t.trace_id)} · ${t.span_count} span${t.span_count === 1 ? "" : "s"}${t.incomplete ? " · incomplete" : ""}`;
  return (
    <select
      className="trace-select"
      data-testid="trace-select"
      aria-label="Trace"
      value={selected ?? ""}
      onChange={(e) => {
        if (e.target.value) onSelect(e.target.value);
      }}
    >
      {selected == null && <option value="">No traces at the cursor</option>}
      {failed.length > 0 && (
        <optgroup label={`Failed (${failed.length})`}>
          {failed.map((t) => (
            <option key={`f-${t.trace_id}`} value={t.trace_id}>
              {label(t)}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={listed.length > MAX_OPTIONS ? `All traces (${listed.length}, first ${MAX_OPTIONS} listed)` : `All traces (${listed.length})`}>
        {shown.map((t) => (
          <option key={t.trace_id} value={t.trace_id}>
            {label(t)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
