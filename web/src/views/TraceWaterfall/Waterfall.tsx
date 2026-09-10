import { useRef } from "react";
import type { TraceSpan } from "../../types/protocol";
import { fmtDurationNs } from "../../lib/format";
import { spanDepths, traceExtent } from "../../lib/traceSelect";
import { useElementWidth } from "../../lib/useElementWidth";

const MAX_ROWS = 60;
const AXIS_H = 16;

type Props = {
  spans: TraceSpan[];
  visible: TraceSpan[];
  criticalIds: Set<string>;
  deltaBySpan: Map<string, number>;
};

// Full-width waterfall: a time axis across the trace extent, then one row per
// span with the label line above its track so the bar gets the whole width.
export function Waterfall({ spans, visible, criticalIds, deltaBySpan }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const extent = traceExtent(spans);
  const depths = spanDepths(spans);
  if (!extent) return null;
  const span = Math.max(1, extent.end - extent.start);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const rows = visible.slice(0, MAX_ROWS);
  const hidden = visible.length - rows.length;

  return (
    <div className="wf" ref={wrapRef}>
      <svg className="wf-axis" width={width} height={AXIS_H} viewBox={`0 0 ${width} ${AXIS_H}`} aria-hidden="true">
        <line x1={0} y1={AXIS_H - 1} x2={width} y2={AXIS_H - 1} />
        {ticks.map((f, i) => {
          const x = f * width;
          const anchor = i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle";
          return (
            <g key={f}>
              <line x1={x} y1={AXIS_H - 5} x2={x} y2={AXIS_H - 1} />
              <text x={x} y={AXIS_H - 7} textAnchor={anchor}>
                {fmtDurationNs(f * span)}
              </text>
            </g>
          );
        })}
      </svg>
      {rows.map((s) => {
        const left = ((s.start_time_ns - extent.start) / span) * 100;
        const w = Math.max(0.5, (s.duration_ns / span) * 100);
        const hot = String(s.status).toLowerCase() === "error";
        const critical = criticalIds.has(s.span_id);
        const delta = deltaBySpan.get(s.span_id);
        const depth = Math.min(4, depths.get(s.span_id) ?? 0);
        return (
          <div key={s.span_id} className="wf-row">
            <div className="wf-label" style={{ paddingLeft: depth * 8 }} title={`${s.service ?? "?"} / ${s.operation} · ${fmtDurationNs(s.duration_ns)}`}>
              {critical && <span className="critical-dot" title="on critical path" />}
              <span className="wf-name">
                {s.service ?? "?"} · {s.operation}
                {s.missing_parent && <span className="hint"> missing parent</span>}
              </span>
              {delta != null && delta > 0 && <span className="delta-tag">+{(delta / 1e6).toFixed(1)}ms</span>}
            </div>
            <div className="wf-track">
              <div
                className={`span-bar${hot ? " error" : ""}${critical ? " critical" : ""}`}
                style={{ left: `${left}%`, width: `${w}%` }}
                title={`${fmtDurationNs(s.duration_ns)}${critical ? " · critical path" : ""}`}
              />
            </div>
          </div>
        );
      })}
      {hidden > 0 && <p className="hint">+{hidden} spans not drawn</p>}
    </div>
  );
}
