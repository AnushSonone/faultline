import { useRef } from "react";
import { fmtOffset } from "../../lib/format";
import { useElementWidth } from "../../lib/useElementWidth";

const H = 56;
const AXIS_Y = 34;
const PAD = 8;

type Props = {
  startNs: number;
  endNs: number;
  faultStartNs: number | null;
  faultEndNs: number | null;
  deployNs: number | null;
  cursorNs: number | null;
};

// The recording on one event-time line: the fault-injection window from
// labels.json, a deployment tick where one exists, and the replay cursor.
export function RecordingTimeline({ startNs, endNs, faultStartNs, faultEndNs, deployNs, cursorNs }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const span = Math.max(1, endNs - startNs);
  const x = (ns: number) => PAD + (Math.min(Math.max(ns, startNs), endNs) - startNs) / span * (width - PAD * 2);
  const fracs = width < 330 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const injectX = faultStartNs != null ? x(faultStartNs) : null;
  const injectLeft = injectX != null && injectX < width / 2;

  return (
    <div className="rec-wrap" ref={wrapRef} data-testid="case-recording">
      <svg className="rec-svg" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Recording timeline">
        <line className="rec-axis" x1={PAD} y1={AXIS_Y} x2={width - PAD} y2={AXIS_Y} />
        {faultStartNs != null && (
          <rect
            className="rec-fault"
            x={x(faultStartNs)}
            y={AXIS_Y - 8}
            width={Math.max(2, x(faultEndNs ?? endNs) - x(faultStartNs))}
            height={16}
            rx={2}
          />
        )}
        {deployNs != null && <line className="rec-deploy" x1={x(deployNs)} y1={AXIS_Y - 6} x2={x(deployNs)} y2={AXIS_Y + 6} />}
        {injectX != null && (
          <>
            <line className="rec-inject" x1={injectX} y1={16} x2={injectX} y2={AXIS_Y + 8} />
            <text x={injectX + (injectLeft ? 4 : -4)} y={12} textAnchor={injectLeft ? "start" : "end"} className="rec-inject-label">
              injected {fmtOffset(faultStartNs, startNs)}
            </text>
          </>
        )}
        {cursorNs != null && (
          <>
            <line className="rec-cursor" x1={x(cursorNs)} y1={18} x2={x(cursorNs)} y2={AXIS_Y + 12} />
            <path className="rec-cursor-head" d={`M ${x(cursorNs) - 4} 18 L ${x(cursorNs) + 4} 18 L ${x(cursorNs)} 23 Z`} />
          </>
        )}
        {fracs.map((f, i) => {
          const tx = PAD + f * (width - PAD * 2);
          const anchor = i === 0 ? "start" : i === fracs.length - 1 ? "end" : "middle";
          return (
            <text key={f} x={tx} y={H - 6} textAnchor={anchor}>
              {fmtOffset(startNs + f * span, startNs)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
