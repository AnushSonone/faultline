import { useEffect, useMemo, useRef, useState } from "react";
import { TraceNotFoundError } from "../../api/client";
import { useInvestigation } from "../../state/investigation";
import type { TraceDetail, TraceSpan } from "../../types/protocol";
import { fmtOffset, shortTraceId } from "../../lib/format";
import { fetchTraceCached } from "../../lib/traceCache";
import { reconcileSelection } from "../../lib/traceSelect";
import { EmptyState } from "../../components/EmptyState";
import { TracePicker } from "./TracePicker";
import { TraceHeader } from "./TraceHeader";
import { Waterfall } from "./Waterfall";

type Filter = "all" | "critical" | "errors";

type DetailState =
  | { kind: "idle" }
  | { kind: "loading"; id: string }
  | { kind: "ready"; id: string; detail: TraceDetail }
  | { kind: "ahead"; id: string }
  | { kind: "error"; id: string; message: string };

const REFETCH_MS = 1000;

// One sampled trace at the cursor. Selection is reconciled against the list
// the server republishes every tick, so something is always selected when
// anything is listed and a stale selection (after Play rewinds the cursor)
// is replaced. A 404 means the trace is ahead of the cursor: said so, never
// swallowed, and refetched as the cursor advances.
export function TraceWaterfall() {
  const sessionId = useInvestigation((s) => s.sessionId);
  const traces = useInvestigation((s) => s.traces);
  const selectedTrace = useInvestigation((s) => s.selectedTrace);
  const selectTrace = useInvestigation((s) => s.selectTrace);
  const rootCauses = useInvestigation((s) => s.rootCauses);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const [detail, setDetail] = useState<DetailState>({ kind: "idle" });
  const [filter, setFilter] = useState<Filter>("all");
  const [showComparison, setShowComparison] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);
  const lastRefetch = useRef(0);

  const listed = useMemo(() => traces?.traces ?? [], [traces]);
  const listedIds = useMemo(() => listed.map((t) => t.trace_id), [listed]);
  const failedIds = useMemo(
    () => rootCauses?.candidates?.[0]?.features?.failed_trace_ids ?? [],
    [rootCauses],
  );

  // Reconcile on every list update.
  useEffect(() => {
    const next = reconcileSelection(listedIds, selectedTrace, failedIds);
    if (next !== selectedTrace) selectTrace(next);
  }, [listedIds, failedIds, selectedTrace, selectTrace]);

  // While the trace is ahead of the cursor or still incomplete, refetch as
  // the list republishes (throttled).
  const wantsRefetch =
    detail.kind === "ahead" || (detail.kind === "ready" && detail.detail.dag?.incomplete === true);
  useEffect(() => {
    if (!wantsRefetch) return;
    const now = Date.now();
    if (now - lastRefetch.current < REFETCH_MS) return;
    lastRefetch.current = now;
    setRefetchKey((n) => n + 1);
  }, [wantsRefetch, traces?.projection_version]);

  useEffect(() => {
    if (!selectedTrace || !sessionId) {
      setDetail({ kind: "idle" });
      return;
    }
    if (!listedIds.includes(selectedTrace)) {
      setDetail({ kind: "ahead", id: selectedTrace });
      return;
    }
    let cancelled = false;
    setDetail((prev) =>
      prev.kind === "ready" && prev.id === selectedTrace ? prev : { kind: "loading", id: selectedTrace },
    );
    fetchTraceCached(sessionId, selectedTrace)
      .then((d) => {
        if (!cancelled) setDetail({ kind: "ready", id: selectedTrace, detail: d });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof TraceNotFoundError) setDetail({ kind: "ahead", id: selectedTrace });
        else setDetail({ kind: "error", id: selectedTrace, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
    // listedIds is intentionally not a dependency: membership is re-checked
    // through the reconcile effect, and refetchKey drives retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedTrace, refetchKey]);

  const ready = detail.kind === "ready" ? detail.detail : null;
  const spans: TraceSpan[] = ready?.dag?.spans ?? [];
  const criticalIds = useMemo(() => new Set(ready?.critical_path?.span_ids ?? []), [ready]);
  const comparison = ready?.comparison ?? null;
  const deltaBySpan = useMemo(() => {
    const m = new Map<string, number>();
    if (comparison) {
      for (const d of comparison.aligned) {
        if (d.failed_span_id && d.delta_ns != null) m.set(d.failed_span_id, d.delta_ns);
      }
    }
    return m;
  }, [comparison]);

  const visible = spans.filter((s) => {
    if (filter === "critical") return criticalIds.has(s.span_id);
    if (filter === "errors") return String(s.status).toLowerCase() === "error";
    return true;
  });

  const firstFailedListed = failedIds.find((id) => listedIds.includes(id)) ?? null;

  return (
    <div className="panel-body" data-testid="waterfall">
      <TracePicker listed={listed} failedIds={failedIds} selected={selectedTrace} onSelect={selectTrace} />

      {selectedTrace && detail.kind !== "idle" && (
        <TraceHeader traceId={selectedTrace} detail={ready} state={detail.kind} />
      )}

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
        {detail.kind === "ready" && spans.length > 0 && (
          <Waterfall spans={spans} visible={visible} criticalIds={criticalIds} deltaBySpan={deltaBySpan} />
        )}
        {detail.kind === "ready" && spans.length === 0 && (
          <EmptyState title="No spans yet" hint="This trace has no spans at the cursor." />
        )}
        {detail.kind === "ahead" && (
          <div className="empty-state trace-ahead" data-testid="trace-ahead">
            <p className="empty-title">
              Trace {shortTraceId(detail.id)} has no spans at the cursor ({fmtOffset(cursor, startNs)}).
            </p>
            <p className="hint">Seek forward, or pick a trace that is already listed.</p>
            <div className="trace-ahead-actions">
              {firstFailedListed && (
                <button type="button" className="link-button" onClick={() => selectTrace(firstFailedListed)}>
                  Pick the first failed trace
                </button>
              )}
              {listedIds.length > 0 && (
                <button type="button" className="link-button" onClick={() => selectTrace(listedIds[0])}>
                  Pick the first listed trace
                </button>
              )}
            </div>
          </div>
        )}
        {detail.kind === "error" && (
          <EmptyState title="Trace detail failed" hint={detail.message} />
        )}
        {detail.kind === "idle" && (
          <EmptyState title="No traces at the cursor" hint="Play or seek to stream spans." />
        )}
      </div>
    </div>
  );
}
