import { useMemo, useState } from "react";
import { useInvestigation } from "../../state/investigation";
import { fmtBytes, fmtCount, fmtDurationNs, fmtOffset, titleCase } from "../../lib/format";
import { Stat } from "../../components/Stat";
import { InfoTip } from "../../components/InfoTip";

const TIPS: Record<string, string> = {
  watermark:
    "Event-time watermark: the engine will not wait for earlier events below this time (minus lateness).",
  lateness: "Allowed lateness before a partition watermark advances past an event.",
  revision: "Window revision increments when late-but-revisable events update a result.",
  state: "Bounded operator state size in bytes (sketches, windows, join buffers).",
  backpressure: "Queue utilization relative to capacity. High values mean an operator is limiting throughput.",
};

type OpNode = {
  stable_id: string;
  operator_type: string;
  query_id?: string;
  rows_in?: number;
  rows_out?: number;
  state_bytes?: number;
  active_windows?: number;
  finalized_windows?: number;
  watermark_ns?: number;
  queue_depth?: number;
  queue_capacity?: number;
  percentile?: {
    estimated_p99?: number | null;
    sketch_state_bytes?: number;
    observations?: number;
    alpha?: number;
  } | null;
  temporal_join?: {
    left_state_rows?: number;
    right_state_rows?: number;
    matches?: number;
    unmatched_rows?: number;
    expired_rows?: number;
  } | null;
};

function fmtQueue(depth: number | undefined, capacity: number | undefined): string {
  const d = depth ?? 0;
  const cap = capacity ?? 0;
  const pct = cap > 0 ? Math.round((d / cap) * 100) : 0;
  return `${d} / ${cap} (${pct}%)`;
}

export function RuntimeInspectorPanel() {
  const inspector = useInvestigation((s) => s.runtimeInspector);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
  const incidentStartNs = useInvestigation((s) => s.incidentStartNs);
  const selectedOperator = useInvestigation((s) => s.selectedOperator);
  const selectOperator = useInvestigation((s) => s.selectOperator);
  const selectedHeatmapCell = useInvestigation((s) => s.selectedHeatmapCell);
  const [open, setOpen] = useState(false);

  const operators: OpNode[] = useMemo(() => {
    if (!inspector) return [];
    if (Array.isArray(inspector.operators) && inspector.operators.length) {
      return inspector.operators as OpNode[];
    }
    return (inspector.operator_metrics ?? []).map((m) => ({
      stable_id: m.operator_id,
      operator_type: m.operator_id,
      rows_in: m.rows_in,
      queue_depth: m.queue_depth,
    }));
  }, [inspector]);

  const selected = operators.find((o) => o.stable_id === selectedOperator) ?? null;

  if (!inspector) {
    return (
      <details className="inspector" data-testid="runtime-inspector">
        <summary>Runtime inspector</summary>
        <p className="muted">No runtime metrics yet.</p>
      </details>
    );
  }

  const et = inspector.event_time;
  const bp = inspector.backpressure;
  const wm = et?.global_watermark_ns ?? inspector.global_watermark_ns;
  const dag = operators
    .map((o) => o.operator_type)
    .filter(Boolean)
    .join(" → ");

  return (
    <details
      className="inspector"
      data-testid="runtime-inspector"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        Runtime inspector · {heatmapMode} · watermark {fmtOffset(wm, incidentStartNs)}
      </summary>

      <section className="inspector-section" data-testid="inspector-overview">
        <h3>Overview</h3>
        <div className="stat-grid">
          <Stat label="Projection mode" value={inspector.projection_mode} />
          <Stat
            label="Replay"
            value={`${inspector.session?.replay_state ?? "-"} @ ${inspector.session?.replay_speed ?? "-"}`}
          />
          <Stat
            label="Global watermark"
            mono
            value={fmtOffset(wm, incidentStartNs)}
            tip={<InfoTip>{TIPS.watermark}</InfoTip>}
          />
          <Stat
            label="Watermark lag"
            mono
            value={fmtDurationNs(et?.watermark_lag_ns ?? 0)}
            tip={<InfoTip>{TIPS.watermark}</InfoTip>}
          />
          <Stat
            label="Events processed"
            mono
            value={fmtCount(inspector.ingestion?.events_received ?? inspector.rows_processed ?? 0)}
          />
          <Stat
            label="Batches processed"
            mono
            value={fmtCount(inspector.batching?.batches_created ?? inspector.batches_processed ?? 0)}
          />
          <Stat label="Active windows" mono value={fmtCount(inspector.active_window_count)} />
          <Stat
            label="Late events"
            mono
            value={fmtCount(et?.late_but_revisable_events ?? inspector.late_events)}
            tip={<InfoTip>{TIPS.revision}</InfoTip>}
          />
          <Stat
            label="Beyond grace events"
            mono
            value={fmtCount(et?.beyond_grace_events ?? inspector.beyond_grace_events ?? 0)}
          />
          <Stat
            label="Backpressure"
            value={`${bp?.any_queue_saturated ? "saturated" : "ok"} (${(
              (bp?.max_queue_utilization ?? 0) * 100
            ).toFixed(0)}%)`}
            hint={bp?.limiting_operator_id ? `limit: ${bp.limiting_operator_id}` : undefined}
            tip={<InfoTip>{TIPS.backpressure}</InfoTip>}
          />
        </div>
      </section>

      <section className="inspector-section" data-testid="inspector-operator-graph">
        <h3>Operator graph</h3>
        <p className="mono" data-testid="operator-dag">
          {dag || "MetricSource → Filter → Window → P99 → HeatmapSink"}
        </p>
        <ul className="inspector-ops">
          {operators.map((o) => (
            <li key={o.stable_id}>
              <button
                type="button"
                className={selectedOperator === o.stable_id ? "selected-op" : undefined}
                data-testid={`op-${o.stable_id}`}
                onClick={() =>
                  selectOperator(selectedOperator === o.stable_id ? null : o.stable_id)
                }
              >
                {titleCase(o.operator_type)}{" "}
                <span className="mono hint">{o.stable_id}</span>
              </button>
              <span className="muted">
                {" "}
                in:{fmtCount(o.rows_in ?? 0)} state:{fmtBytes(o.state_bytes ?? 0)}
                {o.percentile?.estimated_p99 != null
                  ? ` p99:${o.percentile.estimated_p99.toFixed(1)}`
                  : ""}
                {o.temporal_join
                  ? ` join L/R:${fmtCount(o.temporal_join.left_state_rows ?? 0)}/${fmtCount(
                      o.temporal_join.right_state_rows ?? 0,
                    )}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="inspector-detail" data-testid="operator-detail">
            <strong>{selected.stable_id}</strong>
            <dl className="kv-grid">
              <dt>Type</dt>
              <dd>{titleCase(selected.operator_type)}</dd>
              <dt>Query</dt>
              <dd className="mono">{selected.query_id ?? "-"}</dd>
              <dt>Rows in / out</dt>
              <dd className="mono">
                {fmtCount(selected.rows_in ?? 0)} / {fmtCount(selected.rows_out ?? 0)}
              </dd>
              <dt>
                State <InfoTip>{TIPS.state}</InfoTip>
              </dt>
              <dd className="mono">{fmtBytes(selected.state_bytes ?? 0)}</dd>
              <dt>Windows active / final</dt>
              <dd className="mono">
                {fmtCount(selected.active_windows ?? 0)} /{" "}
                {fmtCount(selected.finalized_windows ?? 0)}
              </dd>
              <dt>
                Watermark <InfoTip>{TIPS.watermark}</InfoTip>
              </dt>
              <dd className="mono">{fmtOffset(selected.watermark_ns, incidentStartNs)}</dd>
              <dt>
                Queue <InfoTip>{TIPS.backpressure}</InfoTip>
              </dt>
              <dd className="mono">{fmtQueue(selected.queue_depth, selected.queue_capacity)}</dd>
              {selected.percentile && (
                <>
                  <dt>Sketch observations</dt>
                  <dd className="mono">{fmtCount(selected.percentile.observations ?? 0)}</dd>
                  <dt>Sketch bytes</dt>
                  <dd className="mono">{fmtBytes(selected.percentile.sketch_state_bytes ?? 0)}</dd>
                  <dt>Alpha</dt>
                  <dd className="mono">{selected.percentile.alpha ?? "-"}</dd>
                </>
              )}
              {selected.temporal_join && (
                <>
                  <dt>Matches</dt>
                  <dd className="mono">{fmtCount(selected.temporal_join.matches ?? 0)}</dd>
                  <dt>Unmatched</dt>
                  <dd className="mono">{fmtCount(selected.temporal_join.unmatched_rows ?? 0)}</dd>
                  <dt>Expired</dt>
                  <dd className="mono">{fmtCount(selected.temporal_join.expired_rows ?? 0)}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </section>

      <section className="inspector-section" data-testid="inspector-watermark">
        <h3>Watermark</h3>
        <dl className="kv-grid">
          <dt>
            Global <InfoTip>{TIPS.watermark}</InfoTip>
          </dt>
          <dd className="mono">
            {fmtOffset(et?.global_watermark_ns ?? inspector.global_watermark_ns, incidentStartNs)}
          </dd>
          <dt>Max event time</dt>
          <dd className="mono">{fmtOffset(et?.max_event_time_ns, incidentStartNs)}</dd>
          <dt>
            Allowed lateness <InfoTip>{TIPS.lateness}</InfoTip>
          </dt>
          <dd className="mono">
            {fmtDurationNs(et?.allowed_lateness_ns ?? inspector.allowed_lateness_ns)}
          </dd>
          <dt>Lag</dt>
          <dd className="mono">{fmtDurationNs(et?.watermark_lag_ns ?? 0)}</dd>
          <dt>Idle partitions</dt>
          <dd className="mono">{fmtCount(et?.idle_partitions ?? 0)}</dd>
        </dl>
        <div className="wm-bar" title={TIPS.watermark} data-testid="wm-timeline">
          <div
            className="wm-fill"
            style={{
              width: `${Math.min(
                100,
                (() => {
                  const maxEt = et?.max_event_time_ns ?? 0;
                  const gwm = et?.global_watermark_ns ?? inspector.global_watermark_ns;
                  const lag = et?.watermark_lag_ns || 1;
                  if (maxEt <= 0) return 10;
                  return ((gwm - (maxEt - lag)) / lag) * 100;
                })(),
              )}%`,
            }}
          />
        </div>
        <ul className="inspector-list compact">
          {(et?.partition_watermarks ?? []).slice(0, 8).map((p) => (
            <li key={p.partition}>
              {p.partition}: <span className="mono">{fmtOffset(p.watermark_ns, incidentStartNs)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="inspector-section" data-testid="inspector-state">
        <h3>State</h3>
        <ul className="inspector-list">
          <li>
            reorder_buffer:{" "}
            {fmtCount(inspector.ingestion?.reorder_buffer_occupancy ?? inspector.reorder_buffer_size)}
          </li>
          <li>heatmap_revisions: {fmtCount(inspector.heatmap_revisions)}</li>
          {selectedHeatmapCell && (
            <li data-testid="cell-operator-link">
              selected cell → op:{selectedHeatmapCell.operator_id ?? "-"} window:
              {selectedHeatmapCell.window_id ?? "-"}
            </li>
          )}
        </ul>
      </section>

      <section className="inspector-section" data-testid="arch-status-inspector">
        <h3>Architecture status</h3>
        <ul className="inspector-list">
          {(inspector.architecture_status ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </details>
  );
}
