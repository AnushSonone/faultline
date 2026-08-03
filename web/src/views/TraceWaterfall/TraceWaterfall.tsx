import { useEffect, useState } from "react";
import { fetchTrace } from "../../api/client";
import { useInvestigation } from "../../state/investigation";
import type { TraceDetail } from "../../types/protocol";
import { fmtDurationNs, shortTraceId } from "../../lib/format";
import { EmptyState } from "../../components/EmptyState";

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

type Filter = "all" | "critical" | "errors";

export function TraceWaterfall() {
  const traces = useInvestigation((s) => s.traces);
  const selectedTrace = useInvestigation((s) => s.selectedTrace);
  const selectTrace = useInvestigation((s) => s.selectTrace);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showComparison, setShowComparison] = useState(false);

  const list = traces?.traces ?? [];

  useEffect(() => {
    if (!selectedTrace) {
      setDetail(null);
      return;
    }
    fetchTrace(selectedTrace)
      .then((d) => setDetail(d as TraceDetail))
      .catch(() => setDetail(null));
  }, [selectedTrace]);

  const spans: SpanNode[] = (detail?.dag?.spans ?? []) as SpanNode[];
  const criticalIds = new Set(detail?.critical_path?.span_ids ?? []);
  const comparison = detail?.comparison ?? null;
  const baselineBySpan = new Map<string, number>();
  if (comparison) {
    for (const d of comparison.aligned) {
      if (d.failed_span_id && d.delta_ns != null) {
        baselineBySpan.set(d.failed_span_id, d.delta_ns);
      }
    }
  }

  const visible = spans.filter((s) => {
    if (filter === "critical") return criticalIds.has(s.span_id);
    if (filter === "errors") return String(s.status).toLowerCase() === "error";
    return true;
  });

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
            title={t.trace_id}
            onClick={() => selectTrace(t.trace_id)}
          >
            {shortTraceId(t.trace_id)} · {t.span_count} spans
            {t.incomplete && <span className="hint"> · incomplete</span>}
          </button>
        ))}
      </div>

      {selectedTrace && spans.length > 0 && (
        <div className="waterfall-toolbar">
          {(["all", "critical", "errors"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "chip-toggle active" : "chip-toggle"}
              data-testid={`waterfall-filter-${f}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All spans" : f === "critical" ? "Critical path" : "Error path"}
            </button>
          ))}
          {comparison && (
            <button
              type="button"
              className={showComparison ? "chip-toggle active" : "chip-toggle"}
              data-testid="waterfall-compare-toggle"
              onClick={() => setShowComparison(!showComparison)}
            >
              vs healthy
            </button>
          )}
        </div>
      )}

      {showComparison && comparison && (
        <div className="comparison-box" data-testid="trace-comparison">
          <p className="hint">
            vs median healthy trace <span className="mono">{comparison.healthy_trace_id}</span>{" "}
            (comparability {Math.round(comparison.comparable_confidence * 100)}%)
          </p>
          <ul className="comparison-stats">
            <li>
              total excess: <span className="mono">{(comparison.total_excess_ns / 1e6).toFixed(1)} ms</span>
            </li>
            <li>
              critical path delta:{" "}
              <span className="mono">{(comparison.critical_path_delta_ns / 1e6).toFixed(1)} ms</span>
            </li>
            {comparison.added_services.length > 0 && (
              <li>added services: {comparison.added_services.join(", ")}</li>
            )}
            {comparison.removed_services.length > 0 && (
              <li>removed services: {comparison.removed_services.join(", ")}</li>
            )}
          </ul>
          <div data-testid="trace-comparison-deltas">
            {comparison.aligned
              .filter((d) => d.delta_ns != null)
              .slice(0, 6)
              .map((d) => (
                <div key={d.path_key + (d.failed_span_id ?? "")} className="span-row">
                  <div className="span-label">
                    {d.service ?? "?"} / {d.operation}
                  </div>
                  <div className="span-track">
                    <div
                      className={(d.delta_ns ?? 0) > 0 ? "span-bar delta-slow" : "span-bar delta-fast"}
                      style={{
                        width: `${Math.min(
                          100,
                          (Math.abs(d.delta_ns ?? 0) /
                            Math.max(1, Math.abs(comparison.total_excess_ns))) *
                            100,
                        )}%`,
                      }}
                      title={`Δ ${((d.delta_ns ?? 0) / 1e6).toFixed(2)} ms`}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="waterfall">
        {visible.map((s) => {
          const left = ((s.start_time_ns - minStart) / width) * 100;
          const w = Math.max(1, (s.duration_ns / width) * 100);
          const hot = String(s.status).toLowerCase() === "error";
          const critical = criticalIds.has(s.span_id);
          const delta = baselineBySpan.get(s.span_id);
          return (
            <div key={s.span_id} className="span-row">
              <div className="span-label">
                {critical && <span className="critical-dot" title="on critical path" />}
                {s.service ?? "?"} / {s.operation}
                {s.missing_parent && <span className="hint"> missing parent</span>}
                {delta != null && delta > 0 && (
                  <span className="delta-tag">+{(delta / 1e6).toFixed(1)}ms</span>
                )}
              </div>
              <div className="span-track">
                <div
                  className={`span-bar${hot ? " error" : ""}${critical ? " critical" : ""}`}
                  style={{ left: `${left}%`, width: `${w}%` }}
                  title={`${fmtDurationNs(s.duration_ns)}${critical ? " · critical path" : ""}`}
                />
              </div>
            </div>
          );
        })}
        {!selectedTrace && (
          <EmptyState
            title="No trace selected"
            hint="Pick a trace above to see its waterfall"
          />
        )}
      </div>
    </div>
  );
}
