import { useEffect, useState } from "react";
import { checkpoint, crashTest, fetchSnapshot, type SnapshotInfo } from "../../api/client";
import { useInvestigation } from "../../state/investigation";
import { fmtBytes, fmtCount, fmtOffset } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";
import { TERMS } from "../../content/runtime";

// Checkpoint + crash-test controls (TA-042), the checkpoint history from
// the snapshot endpoint, and the full recovery report. Claim discipline:
// checkpoint recovery with idempotent projections, not exactly-once.
export function CheckpointPanel() {
  const sessionId = useInvestigation((s) => s.sessionId);
  const lastCheckpoint = useInvestigation((s) => s.lastCheckpoint);
  const recoveryReport = useInvestigation((s) => s.recoveryReport);
  const recoveryState = useInvestigation((s) => s.recoveryState);
  const inFlight = useInvestigation((s) => s.checkpointInFlight);
  const warnings = useInvestigation((s) => s.engineWarnings);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetchSnapshot(sessionId)
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch(() => {
        /* history is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, lastCheckpoint, recoveryReport]);

  const run = async (fn: (id: string) => Promise<unknown>) => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await fn(sessionId);
    } finally {
      setBusy(false);
    }
  };

  const noDuplicates = recoveryReport != null && recoveryReport.duplicates_after_recovery === false;
  const ids = snapshot?.checkpoints ?? [];
  const rejected = recoveryReport?.rejected;
  const rejectedList = Array.isArray(rejected) ? rejected : [];
  const rejectedCount = Array.isArray(rejected) ? rejected.length : typeof rejected === "number" ? rejected : 0;

  return (
    <div className="panel-body" data-testid="crash-test">
      <div className="op-chips">
        <button
          type="button"
          disabled={!sessionId || busy}
          data-testid="checkpoint-button"
          onClick={() => run(checkpoint)}
        >
          Checkpoint now
        </button>
        <button
          type="button"
          className="primary"
          disabled={!sessionId || busy}
          data-testid="crash-test-button"
          onClick={() => run(crashTest)}
        >
          Crash test
        </button>
        <span
          className={recoveryState === "recovering" ? "pill reconnecting" : recoveryState === "recovered" ? "pill live" : "pill"}
          data-testid="recovery-state"
        >
          <span className="dot" />
          {recoveryState === "recovering" ? "recovering…" : recoveryState === "recovered" ? "recovered" : "idle"}
        </span>
        <InfoTip>{TERMS.checkpoint}</InfoTip>
      </div>

      <div className="ckpt-timeline" data-testid="checkpoint-timeline" aria-label="checkpoint history">
        {ids.length === 0 && !inFlight && <span className="hint">No checkpoint on disk for this session yet.</span>}
        {ids.map((id) => {
          const latest = id === snapshot?.latest_checkpoint;
          const recovered = id === recoveryReport?.recovered_checkpoint_id;
          return (
            <span
              key={id}
              className={["ckpt-tile", latest ? "latest" : "", recovered ? "recovered" : ""].join(" ").trim()}
              title={id}
            >
              <span className="mono ckpt-id">{id.length > 10 ? `…${id.slice(-8)}` : id}</span>
              {latest && <span className="ckpt-tag">LATEST</span>}
              {recovered && <span className="ckpt-tag">recovered</span>}
            </span>
          );
        })}
        {inFlight && (
          <span className="ckpt-tile pending" title={inFlight}>
            <span className="mono ckpt-id">writing…</span>
          </span>
        )}
      </div>

      {lastCheckpoint && (
        <p className="panel-caption" data-testid="checkpoint-info">
          last checkpoint <span className="mono">{lastCheckpoint.checkpoint_id}</span> ·{" "}
          <span className="mono">{fmtBytes(lastCheckpoint.checkpoint_bytes)}</span> ·{" "}
          <span className="mono">{(lastCheckpoint.checkpoint_duration_seconds * 1000).toFixed(1)} ms</span>
          <span className="mono ckpt-path" title={lastCheckpoint.path}>
            {lastCheckpoint.path}
          </span>
        </p>
      )}

      {recoveryReport && (
        <div data-testid="recovery-report" className="recovery">
          <div className="op-stats">
            <div className="stat">
              <span className="eyebrow">Recovered from</span>
              <span className="stat-value mono">{recoveryReport.recovered_checkpoint_id}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Recovery time</span>
              <span className="stat-value mono">{(recoveryReport.recovery_duration_seconds * 1000).toFixed(1)} ms</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Cursor restored to</span>
              <span className="stat-value mono">{fmtOffset(recoveryReport.cursor_ns, startNs)}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Evidence ids re-derived</span>
              <span className="stat-value mono">{fmtCount(recoveryReport.evidence_id_count)}</span>
            </div>
            <div className="stat">
              <span className="eyebrow">Fell back</span>
              <span className="stat-value">
                {recoveryReport.fell_back ? (
                  <span className="pill warn-pill">yes, older checkpoint</span>
                ) : (
                  "no"
                )}
              </span>
            </div>
            <div className="stat">
              <span className="eyebrow">Rejected</span>
              <span className="stat-value mono">{fmtCount(rejectedCount)}</span>
            </div>
          </div>
          {rejectedList.length > 0 && (
            <details className="rt-details">
              <summary>Rejected checkpoints</summary>
              <ul className="rt-list mono">
                {rejectedList.map((r) => (
                  <li key={String(r)}>{String(r)}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="hint" data-testid="duplicate-check">
            {noDuplicates ? (
              `no duplicate evidence after recovery · ${fmtCount(recoveryReport.evidence_id_count)} evidence ids match the checkpointed set`
            ) : (
              <span style={{ color: "var(--danger)", fontWeight: 600 }}>Duplicate evidence detected</span>
            )}
          </p>
        </div>
      )}

      {(warnings.length > 0 || recoveryState !== "idle") && (
        <ol className="rt-trace" aria-label="recovery trace">
          {warnings.map((w) => (
            <li key={w.sequence}>
              <span className="mono trace-seq">#{w.sequence}</span> engine.warning: {w.message}
            </li>
          ))}
          {recoveryState !== "idle" && (
            <li>
              <span className="mono trace-seq">→</span> recovery.started
            </li>
          )}
          {recoveryState === "recovered" && (
            <li>
              <span className="mono trace-seq">→</span> recovery.completed, projections republished at the restored cursor
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
