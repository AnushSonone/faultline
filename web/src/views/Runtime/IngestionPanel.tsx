import { fmtBytes, fmtCount, fmtDurationNs } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";
import { TERMS } from "../../content/runtime";
import type { BatchingStats, IngestionStats } from "../../types/protocol";

const BATCH_MAX_ROWS = 64;
// BatcherConfig.max_age_ns is i64::MAX / 4 in the demo pipeline: no age flush.
const UNBOUNDED_AGE_NS = 1e15;

type Props = { ingestion: IngestionStats; batching: BatchingStats; reorderCapacity: number };

const SIGNAL_CLASS: Record<string, string> = {
  metrics: "sig-metrics",
  spans: "sig-spans",
  logs: "sig-logs",
  changes: "sig-changes",
};

// What came in, by signal, and how it was batched before entering the DAG.
export function IngestionPanel({ ingestion, batching, reorderCapacity }: Props) {
  const total = Math.max(1, ingestion.events_received);
  const bySignal = ingestion.events_by_signal;
  const reorderFrac = reorderCapacity > 0 ? ingestion.reorder_buffer_occupancy / reorderCapacity : 0;
  const rowsFrac = batching.rows_per_batch_avg / BATCH_MAX_ROWS;

  return (
    <>
      <div className="stack-bar" role="img" aria-label="events by signal">
        {bySignal.map((s) => (
          <span
            key={s.signal}
            className={`stack-seg ${SIGNAL_CLASS[s.signal] ?? "sig-other"}`}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.signal}: ${fmtCount(s.count)}`}
          />
        ))}
      </div>
      <div className="wm-badges">
        {bySignal.map((s) => (
          <span key={s.signal} className="metric-chip">
            <span className={`sig-dot ${SIGNAL_CLASS[s.signal] ?? "sig-other"}`} aria-hidden="true" />
            <span className="metric-key">{s.signal}</span>
            <span className="metric-value">{fmtCount(s.count)}</span>
          </span>
        ))}
        <span className="metric-chip">
          <span className="metric-key">received</span>
          <span className="metric-value">{fmtCount(ingestion.events_received)}</span>
        </span>
        <span className="metric-chip" title="dropped: duplicate event ids">
          <span className="metric-key">duplicates</span>
          <span className="metric-value">{fmtCount(ingestion.duplicates)}</span>
        </span>
        <span className="metric-chip" title="rejected: malformed envelopes">
          <span className="metric-key">invalid</span>
          <span className="metric-value">{fmtCount(ingestion.invalid_events)}</span>
        </span>
      </div>

      <div className="gauge-row">
        <span className="eyebrow">
          Reorder buffer <InfoTip>{TERMS.reorder}</InfoTip>
        </span>
        <span className="mini-bar wide" aria-hidden="true">
          <span style={{ width: `${Math.min(100, reorderFrac * 100)}%` }} />
        </span>
        <span className="mono q-val">
          {fmtCount(ingestion.reorder_buffer_occupancy)} / {fmtCount(reorderCapacity)}
        </span>
      </div>

      <div className="op-stats">
        <div className="stat">
          <span className="eyebrow">Batches created</span>
          <span className="stat-value mono">{fmtCount(batching.batches_created)}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Rows per batch</span>
          <span className="stat-value mono">
            <span className="mini-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, rowsFrac * 100)}%` }} />
            </span>{" "}
            {batching.rows_per_batch_avg.toFixed(0)} / {BATCH_MAX_ROWS}
          </span>
        </div>
        <div className="stat">
          <span className="eyebrow">Bytes per batch</span>
          <span className="stat-value mono">{fmtBytes(Math.round(batching.bytes_per_batch_avg))}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Max batch age</span>
          <span className="stat-value mono">
            {batching.max_batch_age_ns > UNBOUNDED_AGE_NS ? "unbounded" : fmtDurationNs(batching.max_batch_age_ns)}
          </span>
        </div>
      </div>
      <div className="wm-badges">
        <span className="hint flush-label">flush reasons</span>
        {batching.batch_flush_reasons.length === 0 && <span className="hint">none yet</span>}
        {batching.batch_flush_reasons.map((r) => (
          <span key={r} className="pill mono">
            {r}
          </span>
        ))}
      </div>
    </>
  );
}
