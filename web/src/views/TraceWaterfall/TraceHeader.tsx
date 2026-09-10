import type { TraceDetail } from "../../types/protocol";
import { fmtDurationNs, shortTraceId } from "../../lib/format";
import { traceExtent, traceStatus } from "../../lib/traceSelect";

type Props = { traceId: string; detail: TraceDetail | null; state: "loading" | "ready" | "ahead" | "error" };

// What is selected, unambiguously: the trace id, span count, status, extent
// and critical-path time, as soon as the detail is in.
export function TraceHeader({ traceId, detail, state }: Props) {
  const spans = detail?.dag?.spans ?? [];
  const status = traceStatus(spans);
  const extent = traceExtent(spans);
  const critical = detail?.critical_path?.critical_duration_ns ?? null;
  return (
    <div className="trace-head" data-testid="trace-selected">
      <strong className="mono" title={traceId}>
        trace {shortTraceId(traceId)}
      </strong>
      {state === "loading" && <span className="pill">loading</span>}
      {state === "ahead" && <span className="pill">ahead of the cursor</span>}
      {state === "error" && <span className="pill down">detail failed</span>}
      {state === "ready" && (
        <>
          <span className="pill mono">
            {spans.length} span{spans.length === 1 ? "" : "s"}
          </span>
          <span className={status === "error" ? "pill down" : "pill live"}>
            <span className="dot" aria-hidden="true" />
            {status === "error" ? "error" : status === "ok" ? "ok" : "unknown"}
          </span>
          {extent && <span className="pill mono">{fmtDurationNs(extent.end - extent.start)}</span>}
          {critical != null && <span className="pill mono">critical {fmtDurationNs(critical)}</span>}
          {detail?.dag?.incomplete && <span className="pill">incomplete</span>}
        </>
      )}
    </div>
  );
}
