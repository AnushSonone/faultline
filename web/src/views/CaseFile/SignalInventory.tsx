import { useMemo } from "react";
import type { TimelineEvent } from "../../types/protocol";
import { fmtCompact } from "../../lib/format";
import { SIGNALS, SignalTotals, type Signal } from "../../components/SignalTotals";

// Timeline events name their signal in the singular; the manifest counts in
// the plural. Deployments and configuration are change events.
function signalOf(event: TimelineEvent): Signal | null {
  switch (event.signal) {
    case "metric":
      return "metrics";
    case "span":
      return "spans";
    case "log":
      return "logs";
    case "deployment":
    case "configuration":
      return "changes";
    default:
      return null;
  }
}

type Props = {
  eventCounts: Record<string, number>;
  events: TimelineEvent[];
  services: string[];
  origin: string | null;
};

// What was recorded: envelope totals per signal from the manifest, then a
// service x signal grid counted from the timeline projection up to the
// cursor, so it fills as the replay runs.
export function SignalInventory({ eventCounts, events, services, origin }: Props) {
  const grid = useMemo(() => {
    const counts = new Map<string, Record<Signal, number>>();
    for (const svc of services) counts.set(svc, { metrics: 0, spans: 0, logs: 0, changes: 0 });
    for (const e of events) {
      const sig = signalOf(e);
      const svc = e.service ?? null;
      if (!sig || !svc) continue;
      let row = counts.get(svc);
      if (!row) {
        row = { metrics: 0, spans: 0, logs: 0, changes: 0 };
        counts.set(svc, row);
      }
      row[sig] += 1;
    }
    const colMax: Record<Signal, number> = { metrics: 0, spans: 0, logs: 0, changes: 0 };
    for (const row of counts.values()) for (const s of SIGNALS) colMax[s] = Math.max(colMax[s], row[s]);
    return { counts, colMax };
  }, [events, services]);

  const rows = useMemo(() => {
    const names = Array.from(grid.counts.keys());
    names.sort((a, b) => {
      if (a === origin) return -1;
      if (b === origin) return 1;
      return a.localeCompare(b);
    });
    return names;
  }, [grid, origin]);

  const shade = (n: number, max: number) =>
    n <= 0 || max <= 0
      ? undefined
      : { background: `color-mix(in oklab, var(--seq-lo), var(--seq-hi) ${Math.round(10 + (Math.log1p(n) / Math.log1p(max)) * 55)}%)` };

  return (
    <div data-testid="case-inventory">
      <SignalTotals eventCounts={eventCounts} />
      {rows.length > 0 && (
        <div className="presence-grid" role="table" aria-label="Events per service and signal at the cursor">
          <div className="presence-row presence-head" role="row">
            <span role="columnheader">service</span>
            {SIGNALS.map((s) => (
              <span key={s} role="columnheader">
                {s}
              </span>
            ))}
          </div>
          {rows.map((svc) => {
            const row = grid.counts.get(svc)!;
            return (
              <div key={svc} className={svc === origin ? "presence-row origin" : "presence-row"} role="row">
                <span className="presence-name" role="rowheader" title={svc}>
                  {svc}
                </span>
                {SIGNALS.map((s) => (
                  <span key={s} className="presence-cell" role="cell" style={shade(row[s], grid.colMax[s])}>
                    {row[s] > 0 ? fmtCompact(row[s]) : "·"}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
