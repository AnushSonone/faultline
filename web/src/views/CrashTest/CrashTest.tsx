import { useState } from "react";
import { checkpoint, crashTest } from "../../api/client";
import { useInvestigation } from "../../state/investigation";
import { fmtBytes } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";

/// Checkpoint + crash-test controls (TA-042). Claim discipline: this is
/// checkpoint recovery with idempotent incident projections, not exactly-once.
export function CrashTestPanel() {
  const sessionId = useInvestigation((s) => s.sessionId);
  const lastCheckpoint = useInvestigation((s) => s.lastCheckpoint);
  const recoveryReport = useInvestigation((s) => s.recoveryReport);
  const recoveryState = useInvestigation((s) => s.recoveryState);
  const [busy, setBusy] = useState(false);

  const run = async (fn: (id: string) => Promise<unknown>) => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await fn(sessionId);
    } finally {
      setBusy(false);
    }
  };

  const noDuplicates =
    recoveryReport != null && recoveryReport["duplicates_after_recovery"] === false;

  return (
    <div className="panel-body" data-testid="crash-test">
      <div className="waterfall-toolbar">
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
        <span className="pill" data-testid="recovery-state">
          {recoveryState === "recovering"
            ? "recovering…"
            : recoveryState === "recovered"
              ? "recovered"
              : "idle"}
        </span>
        <InfoTip>
          Crash test discards all in-memory session state, then restores it from the latest
          on-disk checkpoint. This demonstrates checkpoint recovery with idempotent projections,
          not exactly-once delivery.
        </InfoTip>
      </div>
      {lastCheckpoint && (
        <p className="panel-caption" data-testid="checkpoint-info">
          last checkpoint <span className="mono">{String(lastCheckpoint["checkpoint_id"])}</span>{" "}
          · <span className="mono">{fmtBytes(Number(lastCheckpoint["checkpoint_bytes"]))}</span> ·{" "}
          <span className="mono">
            {(Number(lastCheckpoint["checkpoint_duration_seconds"]) * 1000).toFixed(1)} ms
          </span>
        </p>
      )}
      {recoveryReport && (
        <div data-testid="recovery-report">
          <dl className="kv-grid">
            <dt>Recovered checkpoint</dt>
            <dd className="mono">{String(recoveryReport["recovered_checkpoint_id"])}</dd>
            <dt>Recovery time</dt>
            <dd className="mono">
              {(Number(recoveryReport["recovery_duration_seconds"]) * 1000).toFixed(1)} ms
            </dd>
          </dl>
          <p className="hint" data-testid="duplicate-check">
            {noDuplicates ? (
              "no duplicate evidence after recovery"
            ) : (
              <span style={{ color: "var(--danger)", fontWeight: 600 }}>
                Duplicate evidence detected
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
