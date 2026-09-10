import { useInvestigation } from "../../state/investigation";
import { fmtBytes, fmtCount, fmtDurationNs, fmtOffset } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";
import { OPERATOR_COPY, TERMS } from "../../content/runtime";
import type { OperatorNode } from "../../types/protocol";

type Props = {
  id: string;
  node: OperatorNode | null;
  // The DAG's display type for ghosts (no OperatorNode).
  ghostType?: string;
};

function Bar({ frac, tone }: { frac: number; tone?: "warn" | "danger" }) {
  const w = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  return (
    <span className={tone ? `mini-bar ${tone}` : "mini-bar"} aria-hidden="true">
      <span style={{ width: `${w}%` }} />
    </span>
  );
}

// The selected operator's counters. One card, grouped: identity and copy,
// throughput, state, then the type-specific block (sketch or join).
export function OperatorDetail({ id, node, ghostType }: Props) {
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const type = node?.operator_type ?? ghostType ?? id;
  const copy = OPERATOR_COPY[type] ?? OPERATOR_COPY[id] ?? "";

  if (!node) {
    return (
      <div className="op-detail" data-testid="operator-detail">
        <header className="op-detail-head">
          <strong>{type}</strong>
          <span className="mono hint">{id}</span>
          <span className="pill">not instrumented</span>
        </header>
        {copy && <p className="rt-copy">{copy}</p>}
      </div>
    );
  }

  const util = node.queue_capacity > 0 ? node.queue_depth / node.queue_capacity : 0;
  const p = node.percentile;
  const j = node.temporal_join;
  const pMax = Math.max(p?.estimated_p99 ?? 0, p?.estimated_p95 ?? 0, p?.estimated_p50 ?? 0, 1e-9);

  return (
    <div className="op-detail" data-testid="operator-detail">
      <header className="op-detail-head">
        <strong>{type}</strong>
        <span className="mono hint">{node.stable_id}</span>
        <span className="pill" title="logical query this operator belongs to">
          {node.query_id}
        </span>
      </header>
      {copy && <p className="rt-copy">{copy}</p>}

      <div className="op-stats">
        <div className="stat">
          <span className="eyebrow">Rows in / out</span>
          <span className="stat-value mono">
            {fmtCount(node.rows_in)} / {fmtCount(node.rows_out)}
          </span>
        </div>
        <div className="stat">
          <span className="eyebrow">Batches in / out</span>
          <span className="stat-value mono">
            {fmtCount(node.batches_in)} / {fmtCount(node.batches_out)}
          </span>
        </div>
        <div className="stat">
          <span className="eyebrow">Processing time</span>
          <span className="stat-value mono">{fmtDurationNs(node.processing_time_ns)}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Queue wait</span>
          <span className="stat-value mono">{fmtDurationNs(node.queue_wait_ns)}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">
            Queue <InfoTip>{TERMS.backpressure}</InfoTip>
          </span>
          <span className="stat-value mono">
            <Bar frac={util} tone={util >= 0.85 ? "danger" : util >= 0.5 ? "warn" : undefined} />{" "}
            {fmtCount(node.queue_depth)} / {fmtCount(node.queue_capacity)}
          </span>
        </div>
        <div className="stat">
          <span className="eyebrow">
            State <InfoTip>{TERMS.state}</InfoTip>
          </span>
          <span className="stat-value mono">{fmtBytes(node.state_bytes)}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Windows open/closed</span>
          <span className="stat-value mono">
            {fmtCount(node.active_windows)} / {fmtCount(node.finalized_windows)}
          </span>
        </div>
        <div className="stat">
          <span className="eyebrow">
            Watermark <InfoTip>{TERMS.watermark}</InfoTip>
          </span>
          <span className="stat-value mono">{fmtOffset(node.watermark_ns, startNs)}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">
            Late revisions <InfoTip>{TERMS.revision}</InfoTip>
          </span>
          <span className="stat-value mono">{fmtCount(node.late_revisions)}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Errors</span>
          <span className="stat-value mono">{fmtCount(node.errors)}</span>
        </div>
      </div>

      {p && (
        <div className="op-block">
          <span className="eyebrow">
            DDSketch <InfoTip>{TERMS.ddsketch}</InfoTip>
          </span>
          <div className="q-rows">
            {(
              [
                ["p50", p.estimated_p50],
                ["p95", p.estimated_p95],
                ["p99", p.estimated_p99],
              ] as Array<[string, number | null | undefined]>
            ).map(([k, v]) => (
              <div className="q-row" key={k}>
                <span className="mono q-key">{k}</span>
                <Bar frac={(v ?? 0) / pMax} />
                <span className="mono q-val">{v == null ? "-" : v.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <p className="hint">
            {fmtCount(p.observations)} observations · {fmtBytes(p.sketch_state_bytes)} sketch · alpha{" "}
            {p.alpha}
            {p.validation_relative_error != null
              ? ` · measured relative error ${(p.validation_relative_error * 100).toFixed(2)}%`
              : ""}
          </p>
        </div>
      )}

      {j && (
        <div className="op-block">
          <span className="eyebrow">Temporal interval join</span>
          <div className="join-glyph" aria-hidden="true">
            <span className="join-side">{`-${fmtDurationNs(j.lookback_ns)}`}</span>
            <span className="join-track">
              <span className="join-zero" />
            </span>
            <span className="join-side">{`+${fmtDurationNs(j.lookahead_ns)}`}</span>
          </div>
          <div className="q-rows">
            <div className="q-row">
              <span className="mono q-key">left</span>
              <span className="q-val-wide">{fmtCount(j.left_state_rows)} buffered percentile windows</span>
            </div>
            <div className="q-row">
              <span className="mono q-key">right</span>
              <span className="q-val-wide">{fmtCount(j.right_state_rows)} buffered change events</span>
            </div>
            <div className="q-row">
              <span className="mono q-key">out</span>
              <span className="q-val-wide">
                {fmtCount(j.matches)} matched · {fmtCount(j.unmatched_rows)} unmatched ·{" "}
                {fmtCount(j.expired_rows)} expired
              </span>
            </div>
          </div>
          <p className="hint">
            a window matches a deployment on the same service inside the interval; state{" "}
            {fmtBytes(j.state_bytes)}
          </p>
        </div>
      )}
    </div>
  );
}
