import { useMemo, useState } from "react";
import { useInvestigation } from "../../state/investigation";

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

export function RuntimeInspectorPanel() {
  const inspector = useInvestigation((s) => s.runtimeInspector);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
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
        <summary>Runtime inspector (M3)</summary>
        <p className="muted">No runtime metrics yet.</p>
      </details>
    );
  }

  const et = inspector.event_time;
  const bp = inspector.backpressure;
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
        Runtime inspector - mode:{heatmapMode} wm:
        {et?.global_watermark_ns ?? inspector.global_watermark_ns}
      </summary>

      <section className="inspector-section" data-testid="inspector-overview">
        <h3>Overview</h3>
        <ul className="inspector-list">
          <li>projection_mode: {inspector.projection_mode}</li>
          <li>replay: {inspector.session?.replay_state ?? "-"} @ {inspector.session?.replay_speed ?? "-"}</li>
          <li title={TIPS.watermark}>
            global_watermark_ns: {et?.global_watermark_ns ?? inspector.global_watermark_ns}
          </li>
          <li title={TIPS.watermark}>
            watermark_lag_ns: {et?.watermark_lag_ns ?? 0}
          </li>
          <li>events_processed: {inspector.ingestion?.events_received ?? inspector.rows_processed ?? 0}</li>
          <li>batches_processed: {inspector.batching?.batches_created ?? inspector.batches_processed ?? 0}</li>
          <li>active_windows: {inspector.active_window_count}</li>
          <li title={TIPS.revision}>late_events: {et?.late_but_revisable_events ?? inspector.late_events}</li>
          <li>beyond_grace_events: {et?.beyond_grace_events ?? inspector.beyond_grace_events ?? 0}</li>
          <li title={TIPS.backpressure}>
            backpressure: {bp?.any_queue_saturated ? "saturated" : "ok"} (
            {((bp?.max_queue_utilization ?? 0) * 100).toFixed(0)}%
            {bp?.limiting_operator_id ? `, limit=${bp.limiting_operator_id}` : ""})
          </li>
        </ul>
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
                {o.operator_type} ({o.stable_id})
              </button>
              <span className="muted">
                {" "}
                in:{o.rows_in ?? 0} state:{o.state_bytes ?? 0}
                {o.percentile?.estimated_p99 != null
                  ? ` p99:${o.percentile.estimated_p99.toFixed(1)}`
                  : ""}
                {o.temporal_join
                  ? ` join L/R:${o.temporal_join.left_state_rows}/${o.temporal_join.right_state_rows}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="inspector-detail" data-testid="operator-detail">
            <strong>{selected.stable_id}</strong>
            <ul className="inspector-list">
              <li>type: {selected.operator_type}</li>
              <li>query: {selected.query_id ?? "-"}</li>
              <li>rows in/out: {selected.rows_in ?? 0}/{selected.rows_out ?? 0}</li>
              <li title={TIPS.state}>state_bytes: {selected.state_bytes ?? 0}</li>
              <li>
                windows active/final: {selected.active_windows ?? 0}/
                {selected.finalized_windows ?? 0}
              </li>
              <li title={TIPS.watermark}>watermark_ns: {selected.watermark_ns ?? "-"}</li>
              <li title={TIPS.backpressure}>
                queue: {selected.queue_depth ?? 0}/{selected.queue_capacity ?? 0}
              </li>
              {selected.percentile && (
                <>
                  <li>sketch observations: {selected.percentile.observations ?? 0}</li>
                  <li>sketch bytes: {selected.percentile.sketch_state_bytes ?? 0}</li>
                  <li>alpha: {selected.percentile.alpha ?? "-"}</li>
                </>
              )}
              {selected.temporal_join && (
                <>
                  <li>matches: {selected.temporal_join.matches ?? 0}</li>
                  <li>unmatched: {selected.temporal_join.unmatched_rows ?? 0}</li>
                  <li>expired: {selected.temporal_join.expired_rows ?? 0}</li>
                </>
              )}
            </ul>
          </div>
        )}
      </section>

      <section className="inspector-section" data-testid="inspector-watermark">
        <h3>Watermark</h3>
        <ul className="inspector-list">
          <li title={TIPS.watermark}>
            global: {et?.global_watermark_ns ?? inspector.global_watermark_ns}
          </li>
          <li>max_event_time: {et?.max_event_time_ns ?? "-"}</li>
          <li title={TIPS.lateness}>
            allowed_lateness_ns: {et?.allowed_lateness_ns ?? inspector.allowed_lateness_ns}
          </li>
          <li>lag_ns: {et?.watermark_lag_ns ?? 0}</li>
          <li>idle_partitions: {et?.idle_partitions ?? 0}</li>
        </ul>
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
              {p.partition}: {p.watermark_ns}
            </li>
          ))}
        </ul>
      </section>

      <section className="inspector-section" data-testid="inspector-state">
        <h3>State</h3>
        <ul className="inspector-list">
          <li>reorder_buffer: {inspector.ingestion?.reorder_buffer_occupancy ?? inspector.reorder_buffer_size}</li>
          <li>heatmap_revisions: {inspector.heatmap_revisions}</li>
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
