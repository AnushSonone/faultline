import { useMemo } from "react";
import { useInvestigation } from "../../state/investigation";
import { seek } from "../../api/client";
import type { HeatmapCell } from "../../types/protocol";

export function AnomalyHeatmap() {
  const heatmap = useInvestigation((s) => s.heatmap);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectedOperator = useInvestigation((s) => s.selectedOperator);
  const selectService = useInvestigation((s) => s.selectService);
  const selectOperator = useInvestigation((s) => s.selectOperator);
  const selectHeatmapCell = useInvestigation((s) => s.selectHeatmapCell);
  const sessionId = useInvestigation((s) => s.sessionId);

  const { services, buckets, grid, maxV } = useMemo(() => {
    if (!heatmap) {
      return {
        services: [] as string[],
        buckets: [] as number[],
        grid: new Map<string, HeatmapCell>(),
        maxV: 1,
      };
    }
    const services = [...new Set(heatmap.cells.map((c) => c.service))].sort();
    const buckets = [...new Set(heatmap.cells.map((c) => c.bucket_start_ns))].sort(
      (a, b) => a - b,
    );
    const grid = new Map<string, HeatmapCell>();
    let maxV = 1;
    for (const c of heatmap.cells) {
      grid.set(`${c.service}|${c.bucket_start_ns}`, c);
      maxV = Math.max(maxV, c.value);
    }
    return { services, buckets, grid, maxV };
  }, [heatmap]);

  if (!heatmap) return <div className="panel-body muted">No heatmap yet</div>;

  return (
    <div className="panel-body heatmap-wrap" data-testid="heatmap">
      {heatmap.streaming_note && <p className="hint">{heatmap.streaming_note}</p>}
      <table className="heatmap">
        <thead>
          <tr>
            <th>service</th>
            {buckets.map((b) => (
              <th key={b}>{((b % 1_000_000_000_000) / 1e9).toFixed(0)}s</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {services.map((svc) => (
            <tr
              key={svc}
              className={selectedService === svc ? "selected-row" : undefined}
              onClick={() => selectService(svc)}
            >
              <th scope="row">{svc}</th>
              {buckets.map((b) => {
                const cell = grid.get(`${svc}|${b}`);
                const v = cell?.value ?? 0;
                const intensity = Math.min(1, v / maxV);
                const pattern = intensity > 0.6 ? "dense" : intensity > 0.3 ? "mid" : "low";
                const linked =
                  selectedOperator &&
                  cell?.operator_id &&
                  selectedOperator === cell.operator_id;
                const title = cell
                  ? `${svc} @ ${b}: value=${v.toFixed(2)} p95=${cell.p95?.toFixed?.(2) ?? "-"} p99=${cell.p99?.toFixed?.(2) ?? "-"} (${cell.value_source ?? "unknown"})`
                  : `${svc} @ ${b}: 0`;
                return (
                  <td
                    key={b}
                    className={`cell ${pattern}${linked ? " cell-linked" : ""}`}
                    style={{ opacity: 0.35 + intensity * 0.65 }}
                    title={title}
                    data-testid={cell?.p99 != null ? "heatmap-p99-cell" : undefined}
                    onClick={async (e) => {
                      e.stopPropagation();
                      selectService(svc);
                      selectHeatmapCell(cell ?? null);
                      if (cell?.operator_id) selectOperator(cell.operator_id);
                      if (sessionId) await seek(sessionId, b);
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Latency cells show streaming p99 when available. Topology structure remains precomputed.
      </p>
    </div>
  );
}
