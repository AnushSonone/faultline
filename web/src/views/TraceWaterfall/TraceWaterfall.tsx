import { useEffect, useState } from "react";
import { fetchTrace } from "../../api/client";
import { useInvestigation } from "../../state/investigation";

type SpanNode = {
  span_id: string;
  parent_span_id?: string | null;
  service?: string | null;
  operation: string;
  start_time_ns: number;
  end_time_ns: number;
  duration_ns: number;
  status: string;
  missing_parent: boolean;
};

export function TraceWaterfall() {
  const traces = useInvestigation((s) => s.traces);
  const selectedTrace = useInvestigation((s) => s.selectedTrace);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectTrace = useInvestigation((s) => s.selectTrace);
  const [spans, setSpans] = useState<SpanNode[]>([]);

  const list = traces?.traces ?? [];

  useEffect(() => {
    if (!selectedTrace) {
      setSpans([]);
      return;
    }
    fetchTrace(selectedTrace)
      .then((dag) => {
        let s = (dag.spans ?? []) as SpanNode[];
        if (selectedService) {
          // keep full waterfall but we still show all spans for context
        }
        setSpans(s);
      })
      .catch(() => setSpans([]));
  }, [selectedTrace, selectedService]);

  const minStart = spans.reduce((m, s) => Math.min(m, s.start_time_ns), Number.MAX_SAFE_INTEGER);
  const maxEnd = spans.reduce((m, s) => Math.max(m, s.end_time_ns), 0);
  const width = Math.max(1, maxEnd - minStart);

  return (
    <div className="panel-body" data-testid="waterfall">
      <div className="trace-list">
        {list.slice(0, 40).map((t) => (
          <button
            key={t.trace_id}
            type="button"
            className={selectedTrace === t.trace_id ? "trace-item active" : "trace-item"}
            onClick={() => selectTrace(t.trace_id)}
          >
            {t.trace_id} · {t.span_count} spans{t.incomplete ? " · incomplete" : ""}
          </button>
        ))}
      </div>
      <div className="waterfall">
        {spans.map((s) => {
          const left = ((s.start_time_ns - minStart) / width) * 100;
          const w = Math.max(1, (s.duration_ns / width) * 100);
          const hot = String(s.status).toLowerCase() === "error";
          const miss = s.missing_parent;
          return (
            <div key={s.span_id} className="span-row">
              <div className="span-label">
                {s.service ?? "?"} / {s.operation}
                {miss ? " ⚠ parent" : ""}
              </div>
              <div className="span-track">
                <div
                  className={hot ? "span-bar error" : "span-bar"}
                  style={{ left: `${left}%`, width: `${w}%` }}
                  title={`${s.duration_ns}ns`}
                />
              </div>
            </div>
          );
        })}
        {!selectedTrace && <p className="muted">Select a trace</p>}
      </div>
    </div>
  );
}
