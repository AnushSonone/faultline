import { fmtCompact } from "../lib/format";

export const SIGNALS = ["metrics", "spans", "logs", "changes"] as const;
export type Signal = (typeof SIGNALS)[number];

// Envelope totals per signal from the manifest: one stacked bar and four
// chips. Shared by the Case file's inventory, which adds the per-service grid
// beneath it, and the rail dossier, which is too narrow for that grid.
export function SignalTotals({ eventCounts }: { eventCounts: Record<string, number> }) {
  const total = SIGNALS.reduce((n, s) => n + (eventCounts[s] ?? 0), 0);
  return (
    <>
      <div className="stack-bar" aria-hidden="true">
        {SIGNALS.map((s) => {
          const n = eventCounts[s] ?? 0;
          if (n <= 0) return null;
          return (
            <span
              key={s}
              className={`stack-seg sig-${s} nonzero`}
              style={{ width: `${(n / Math.max(1, total)) * 100}%` }}
            />
          );
        })}
      </div>
      {/* Counts as counts: --text-md values over an 11px label, in .stat-grid,
          rather than four 11px pills. */}
      <div className="stat-grid case-stats">
        {SIGNALS.map((s) => (
          <div key={s} className="stat">
            <span className="eyebrow">
              <span className={`sig-dot sig-${s}`} aria-hidden="true" /> {s}
            </span>
            <span className="stat-value">{fmtCompact(eventCounts[s] ?? 0)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
