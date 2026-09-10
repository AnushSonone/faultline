import { useEffect, useMemo, useState } from "react";
import type { TraceDetail } from "../../types/protocol";
import { fmtDurationNs } from "../../lib/format";
import { aggregateRoutes, sampleTraceIds, type RouteRow } from "../../lib/routes";
import { fetchTraceCached } from "../../lib/traceCache";
import { useCursorTick } from "../../lib/useCursorTick";

const MAX_ROWS = 6;
const SAMPLE = 8;

type Props = {
  sessionId: string | null;
  listedIds: string[];
  failedIds: string[];
  origin: string | null;
};

function shortName(service: string): string {
  return service.replace(/service$/i, "");
}

// Distinct caller-to-callee chains from a sample of traces at the cursor,
// failed traces first. Traces ahead of the cursor (404) are skipped.
export function RouteList({ sessionId, listedIds, failedIds, origin }: Props) {
  const tick = useCursorTick(2000);
  const [details, setDetails] = useState<TraceDetail[]>([]);
  const sample = useMemo(() => sampleTraceIds(listedIds, failedIds, SAMPLE), [listedIds, failedIds]);
  const sampleKey = sample.join(",");

  useEffect(() => {
    if (!sessionId || sample.length === 0) {
      setDetails([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      sample.map((id) => fetchTraceCached(sessionId, id).catch(() => null)),
    ).then((all) => {
      if (cancelled) return;
      setDetails(all.filter((d): d is TraceDetail => d != null));
    });
    return () => {
      cancelled = true;
    };
    // sampleKey stands in for the sample array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sampleKey, tick]);

  const rows: RouteRow[] = useMemo(() => aggregateRoutes(details, origin), [details, origin]);
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;

  if (listedIds.length === 0) {
    return <p className="hint">No traces at the cursor yet. Play or seek to stream spans.</p>;
  }

  return (
    <div className="route-list" data-testid="case-routes">
      <div className="route-row route-head" aria-hidden="true">
        <span>route</span>
        <span>traces</span>
        <span>failed</span>
      </div>
      {shown.map((r) => (
        <div key={r.key} className={r.throughOrigin ? "route-row through-origin" : "route-row"}>
          <span
            className="route-chain"
            title={`${r.chain.join(" > ")}${r.medianDurationNs != null ? ` · median ${fmtDurationNs(r.medianDurationNs)}` : ""}`}
          >
            {r.chain.map((svc, i) => (
              <span key={`${svc}-${i}`}>
                {i > 0 && <span className="route-sep"> &gt; </span>}
                {shortName(svc)}
              </span>
            ))}
          </span>
          <span className="mono">{r.sampled}</span>
          <span className={r.failed > 0 ? "mono route-failed" : "mono"}>{r.failed}</span>
        </div>
      ))}
      {shown.length === 0 && <p className="hint">Sampling traces at the cursor…</p>}
      {more > 0 && <p className="hint">{more} more route{more === 1 ? "" : "s"} in the sample</p>}
    </div>
  );
}
