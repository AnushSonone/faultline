type Props = {
  lines: string[];
  incidentId: string;
  heatmapMode: string;
  adversarial: boolean;
};

function tone(source: string): "streaming" | "precomputed" | "neutral" {
  const s = source.toLowerCase();
  if (s.includes("precomputed")) return "precomputed";
  if (s.includes("streaming")) return "streaming";
  return "neutral";
}

// The honesty table: each architecture_status line split on its first ": "
// into surface and source, tagged streaming or precomputed.
export function ArchStatus({ lines, incidentId, heatmapMode, adversarial }: Props) {
  const rows = lines.map((line) => {
    const i = line.indexOf(": ");
    return i > 0 ? { surface: line.slice(0, i), source: line.slice(i + 2) } : { surface: line, source: "" };
  });
  return (
    <div className="arch-table" data-testid="arch-status">
      <span className="arch-surface">Incident</span>
      <span className="arch-source mono">{incidentId}</span>
      <span className="arch-surface">Heatmap values</span>
      <span className="arch-source">
        <span className={`src-pill ${tone(heatmapMode)}`}>{heatmapMode}</span>
      </span>
      <span className="arch-surface">Arrival order</span>
      <span className="arch-source">{adversarial ? "adversarial (late, out of order)" : "normal"}</span>
      {rows.map((r) => (
        <RowPair key={r.surface + r.source} surface={r.surface} source={r.source} />
      ))}
    </div>
  );
}

function RowPair({ surface, source }: { surface: string; source: string }) {
  const t = tone(source);
  return (
    <>
      <span className="arch-surface">{surface}</span>
      <span className="arch-source">
        {t === "neutral" ? source : <span className={`src-pill ${t}`}>{source}</span>}
      </span>
    </>
  );
}
