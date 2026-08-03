import { useState } from "react";
import { useInvestigation } from "../../state/investigation";
import { fmtCount, titleCase } from "../../lib/format";
import { EmptyState } from "../../components/EmptyState";

const CANONICAL_QUERIES: Record<string, string> = {
  "heatmap p99":
    "SELECT service, TUMBLE(event_time, '1s'), P99(value) AS p99 FROM metrics WHERE name LIKE '%latency%' GROUP BY service",
  "error rate":
    "SELECT service, TUMBLE(event_time, '1s'), AVG(value) AS err FROM metrics WHERE name LIKE '%error_rate%' GROUP BY service",
  "deploy join":
    "SELECT service, name, value, change_id, delay_ns FROM metrics JOIN deployments ON service = service WHERE name LIKE '%latency%' AND change_id != '' ORDER BY delay_ns LIMIT 20",
};

type RunResponse = {
  result?: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    metrics: Record<string, unknown>;
  };
  explain?: {
    logical_plan: string;
    optimized_logical_plan: string;
    physical_plan: { operators: Array<{ operator_id: string; kind: string; detail: string }> };
    operator_ids: string[];
    watermark_policy: string;
    state_retention: string;
  };
  error?: string;
};

export function QueryInspectorPanel() {
  const sessionId = useInvestigation((s) => s.sessionId);
  const selectOperator = useInvestigation((s) => s.selectOperator);
  const [sql, setSql] = useState(CANONICAL_QUERIES["heatmap p99"]);
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/v1/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, session_id: sessionId }),
      });
      setResponse((await r.json()) as RunResponse);
    } catch (e) {
      setResponse({ error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body" data-testid="query-inspector">
      <div className="waterfall-toolbar">
        {Object.entries(CANONICAL_QUERIES).map(([name, q]) => (
          <button
            key={name}
            type="button"
            className={sql === q ? "chip-toggle active" : "chip-toggle"}
            onClick={() => setSql(q)}
          >
            {titleCase(name)}
          </button>
        ))}
      </div>
      <textarea
        className="sql-input mono"
        data-testid="sql-input"
        rows={3}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
      />
      <div className="waterfall-toolbar">
        <button
          type="button"
          className="primary"
          disabled={!sessionId || busy}
          data-testid="run-query-button"
          onClick={run}
        >
          Run + EXPLAIN ANALYZE
        </button>
      </div>

      {!response && (
        <EmptyState title="No query run yet" hint="Run a canned query or write SQL above" />
      )}

      {response?.error && (
        <p className="hint" data-testid="query-error" style={{ color: "var(--danger)" }}>
          {response.error}
        </p>
      )}

      {response?.explain && (
        <div data-testid="query-explain">
          <h3 className="query-h">Optimized logical plan</h3>
          <pre className="plan-tree mono">{response.explain.optimized_logical_plan}</pre>
          <h3 className="query-h">Physical operators</h3>
          <ul className="comparison-stats">
            {response.explain.physical_plan.operators.map((op) => (
              <li key={op.operator_id}>
                <button
                  type="button"
                  className="chip-toggle"
                  data-testid={`query-op-${op.operator_id}`}
                  onClick={() => selectOperator(op.operator_id)}
                >
                  {op.operator_id}
                </button>{" "}
                <span className="muted">
                  {op.kind}: {op.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="hint">
            {response.explain.watermark_policy} · {response.explain.state_retention}
          </p>
        </div>
      )}

      {response?.result && (
        <div data-testid="query-result">
          <h3 className="query-h">
            Result <span className="muted">({response.result.rows.length} rows)</span>
          </h3>
          <div className="heatmap-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
            <table className="score-table">
              <thead>
                <tr>
                  {response.result.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {response.result.rows.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    {response.result!.columns.map((c) => (
                      <td key={c} className="mono">
                        {String(row[c] ?? "∅")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="metric-chips" data-testid="query-metrics">
            {Object.entries(response.result.metrics).map(([key, value]) => (
              <span key={key} className="metric-chip">
                <span className="metric-key">{key}</span>
                <span className="metric-value">
                  {typeof value === "number" ? fmtCount(value) : String(value)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
