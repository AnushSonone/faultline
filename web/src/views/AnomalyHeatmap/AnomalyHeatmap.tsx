import { useMemo } from "react";
import { useInvestigation } from "../../state/investigation";
import { seek } from "../../api/client";

export function AnomalyHeatmap() {
  const heatmap = useInvestigation((s) => s.heatmap);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectService = useInvestigation((s) => s.selectService);
  const sessionId = useInvestigation((s) => s.sessionId);

  const { services, buckets, grid, maxV } = useMemo(() => {
    if (!heatmap) {
      return { services: [] as string[], buckets: [] as number[], grid: new Map<string, number>(), maxV: 1 };
    }
    const services = [...new Set(heatmap.cells.map((c) => c.service))].sort();
    const buckets = [...new Set(heatmap.cells.map((c) => c.bucket_start_ns))].sort((a, b) => a - b);
    const grid = new Map<string, number>();
    let maxV = 1;
    for (const c of heatmap.cells) {
      grid.set(`${c.service}|${c.bucket_start_ns}`, c.value);
      maxV = Math.max(maxV, c.value);
    }
    return { services, buckets, grid, maxV };
  }, [heatmap]);

  if (!heatmap) return <div className="panel-body muted">No heatmap yet</div>;

  return (
    <div className="panel-body heatmap-wrap" data-testid="heatmap">
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
                const v = grid.get(`${svc}|${b}`) ?? 0;
                const intensity = Math.min(1, v / maxV);
                const pattern = intensity > 0.6 ? "dense" : intensity > 0.3 ? "mid" : "low";
                return (
                  <td
                    key={b}
                    className={`cell ${pattern}`}
                    style={{ opacity: 0.35 + intensity * 0.65 }}
                    title={`${svc} @ ${b}: ${v.toFixed(2)}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      selectService(svc);
                      if (sessionId) await seek(sessionId, b);
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Pattern density encodes magnitude (not color-only).</p>
    </div>
  );
}
