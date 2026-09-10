import { useEffect, useRef, useState } from "react";
import { runQuery } from "../../api/client";
import type { Scenario } from "../../content/scenarios";
import { fmtOffset } from "../../lib/format";
import {
  bucketSizeS,
  faultMetricLike,
  faultMetricName,
  metricNameFor,
  parseSeriesRows,
  seriesSql,
  type SeriesPoint,
} from "../../lib/series";
import { useCursorTick } from "../../lib/useCursorTick";
import { useElementWidth } from "../../lib/useElementWidth";

const H = 72;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 6;
const PAD_B = 8;

type Series = { name: string; points: SeriesPoint[]; like: boolean };

type Props = {
  sessionId: string | null;
  scenario: Scenario;
  startNs: number;
  endNs: number;
  faultStartNs: number | null;
  faultEndNs: number | null;
  cursorNs: number | null;
};

function fmtValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (abs >= 10) return v.toFixed(0);
  return v.toFixed(2);
}

// The injected metric at the origin against the same metric on its nearest
// caller, read through the SQL subset at the cursor. Re-queried on a cursor
// throttle; stale responses are discarded by sequence number.
export function FaultSeries({ sessionId, scenario, startNs, endNs, faultStartNs, faultEndNs, cursorNs }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const tick = useCursorTick(2000);
  const [origin, setOrigin] = useState<Series | null>(null);
  const [caller, setCaller] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const spanS = Math.max(1, (endNs - startNs) / 1e9);
  const originSvc = scenario.schematic.origin;
  const callerSvc = scenario.schematic.waves[0]?.[0] ?? null;
  const bucket = bucketSizeS(spanS);

  useEffect(() => {
    if (!sessionId) return;
    const mine = ++seq.current;
    const load = async (service: string, exact: string): Promise<Series> => {
      const first = await runQuery(sessionId, seriesSql(service, exact, spanS));
      if (first.error) throw new Error(first.error);
      const pts = parseSeriesRows(first.result?.rows ?? []);
      if (pts.length > 0 || cursorNs == null || cursorNs < endNs) return { name: exact, points: pts, like: false };
      // Nothing at the end cursor under the exact name: fall back to LIKE.
      const like = faultMetricLike(scenario.schematic.signal);
      const second = await runQuery(sessionId, seriesSql(service, like, spanS, { like: true }));
      if (second.error) throw new Error(second.error);
      return { name: like, points: parseSeriesRows(second.result?.rows ?? []), like: true };
    };
    (async () => {
      try {
        const o = await load(originSvc, faultMetricName(scenario));
        if (seq.current !== mine) return;
        setOrigin(o);
        setError(null);
        if (callerSvc) {
          const c = await load(callerSvc, metricNameFor(callerSvc, scenario));
          if (seq.current !== mine) return;
          setCaller(c);
        }
      } catch (e) {
        if (seq.current !== mine) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [sessionId, scenario, originSvc, callerSvc, spanS, tick, cursorNs, endNs]);

  const all = [...(origin?.points ?? []), ...(caller?.points ?? [])];
  const span = Math.max(1, endNs - startNs);
  const x = (ns: number) => PAD_L + ((Math.min(Math.max(ns, startNs), endNs) - startNs) / span) * (width - PAD_L - PAD_R);
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  for (const p of all) {
    if (p.v < vMin) vMin = p.v;
    if (p.v > vMax) vMax = p.v;
  }
  if (!Number.isFinite(vMin)) {
    vMin = 0;
    vMax = 1;
  }
  if (vMax === vMin) vMax = vMin + 1;
  const y = (v: number) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);
  const path = (pts: SeriesPoint[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = origin?.points[origin.points.length - 1];
  const n = origin?.points.length ?? 0;

  return (
    <div className="series-wrap" ref={wrapRef} data-testid="case-fault-series">
      <svg className="series-svg" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Fault metric series">
        {faultStartNs != null && (
          <rect className="rec-fault" x={x(faultStartNs)} y={PAD_T} width={Math.max(2, x(faultEndNs ?? endNs) - x(faultStartNs))} height={H - PAD_T - PAD_B} rx={2} />
        )}
        <text x={PAD_L - 4} y={PAD_T + 8} textAnchor="end">
          {fmtValue(vMax)}
        </text>
        <text x={PAD_L - 4} y={H - PAD_B} textAnchor="end">
          {fmtValue(vMin)}
        </text>
        {caller && caller.points.length > 1 && <path className="series-caller" d={path(caller.points)} />}
        {origin && origin.points.length > 1 && <path className="series-origin" d={path(origin.points)} />}
        {last && <circle className="series-last" cx={x(last.t)} cy={y(last.v)} r={2.5} />}
        {cursorNs != null && <line className="rec-cursor" x1={x(cursorNs)} y1={PAD_T} x2={x(cursorNs)} y2={H - PAD_B} />}
      </svg>
      <div className="series-legend">
        <span>
          <span className="swatch origin" aria-hidden="true" />
          {origin ? (origin.like ? `${originSvc} (name like ${origin.name})` : origin.name) : originSvc}
        </span>
        {callerSvc && (
          <span>
            <span className="swatch caller" aria-hidden="true" /> {callerSvc}
          </span>
        )}
      </div>
      <p className="hint series-note">
        {error
          ? `Series query failed: ${error}`
          : n === 0
            ? `No samples at the cursor yet. Play or seek past ${fmtOffset(startNs, startNs)}.`
            : bucket == null
              ? `${n} samples at the cursor`
              : `${n} buckets of ${bucket} s (AVG) at the cursor`}
      </p>
    </div>
  );
}
