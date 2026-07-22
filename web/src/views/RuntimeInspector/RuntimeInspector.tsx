import { useInvestigation } from "../../state/investigation";

export function RuntimeInspectorPanel() {
  const inspector = useInvestigation((s) => s.runtimeInspector);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);

  if (!inspector) {
    return (
      <details className="inspector" data-testid="runtime-inspector">
        <summary>Runtime inspector (M3)</summary>
        <p className="muted">No runtime metrics yet.</p>
      </details>
    );
  }

  return (
    <details className="inspector" data-testid="runtime-inspector" open>
      <summary>
        Runtime inspector - heatmap:{heatmapMode} wm:{inspector.global_watermark_ns}
      </summary>
      <ul className="inspector-list">
        <li>projection_mode: {inspector.projection_mode}</li>
        <li>allowed_lateness_ns: {inspector.allowed_lateness_ns}</li>
        <li>late_events: {inspector.late_events}</li>
        <li>reorder_buffer_size: {inspector.reorder_buffer_size}</li>
        <li>active_windows: {inspector.active_window_count}</li>
        <li>finalized_windows: {inspector.finalized_window_count}</li>
        <li>heatmap_revisions: {inspector.heatmap_revisions}</li>
        <li>
          operators:{" "}
          {inspector.operators.map((o) => o.operator_id).join(", ") || "-"}
        </li>
      </ul>
    </details>
  );
}
