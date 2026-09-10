import { useCallback, useEffect, useRef, useState } from "react";
import { useInvestigation } from "../../state/investigation";
import { explainQuery, listQueries, runQuery, type RegisteredQuery, type RunQueryResponse } from "../../api/client";
import { fmtCount } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";
import { CATALOG, CATALOG_CAVEAT } from "../../content/catalog";
import { TERMS } from "../../content/runtime";
import type { ExplainOutput } from "../../types/protocol";

const CANONICAL_QUERIES: Record<string, string> = {
  "heatmap p99":
    "SELECT service, TUMBLE(event_time, '1s'), P99(value) AS p99 FROM metrics WHERE name LIKE '%latency%' GROUP BY service",
  "error rate":
    "SELECT service, TUMBLE(event_time, '1s'), AVG(value) AS err FROM metrics WHERE name LIKE '%error_rate%' GROUP BY service",
  "deploy join":
    "SELECT service, name, value, change_id, delay_ns FROM metrics JOIN deployments ON service = service WHERE name LIKE '%latency%' AND change_id != '' ORDER BY delay_ns LIMIT 20",
};

type Props = { liveOperatorIds: Set<string> };

// SQL over the session at the replay cursor. Catalog reference, the
// per-session registry, the physical plan as a chain that links back to the
// live DAG, and a cardinality funnel.
export function QueryWorkbench({ liveOperatorIds }: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const selectOperator = useInvestigation((s) => s.selectOperator);
  const setRuntimeTab = useInvestigation((s) => s.setRuntimeTab);
  const selectedOperator = useInvestigation((s) => s.selectedOperator);
  const [sql, setSql] = useState(CANONICAL_QUERIES["heatmap p99"]);
  const [response, setResponse] = useState<RunQueryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [registry, setRegistry] = useState<RegisteredQuery[]>([]);
  const [showLogical, setShowLogical] = useState(false);
  const querySeed = useInvestigation((s) => s.querySeed);
  const seedQuery = useInvestigation((s) => s.seedQuery);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshRegistry = useCallback(() => {
    if (!sessionId) return;
    listQueries(sessionId)
      .then(setRegistry)
      .catch(() => setRegistry([]));
  }, [sessionId]);

  // The Case file hands its raw-records query over; take it once and clear.
  // It already ran there, so the registry has an entry to show.
  useEffect(() => {
    if (!querySeed) return;
    setSql(querySeed);
    setResponse(null);
    seedQuery(null);
    refreshRegistry();
  }, [querySeed, seedQuery, refreshRegistry]);

  useEffect(() => {
    setResponse(null);
    setRegistry([]);
    refreshRegistry();
  }, [sessionId, refreshRegistry]);

  const run = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      setResponse(await runQuery(sessionId, sql));
      refreshRegistry();
    } catch (e) {
      setResponse({ error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const explainOnly = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const r = await explainQuery(sessionId, sql);
      setResponse({ explain: r.explain, error: r.error });
    } catch (e) {
      setResponse({ error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const insertAtCaret = (text: string) => {
    const el = inputRef.current;
    if (!el) {
      setSql((s) => `${s} ${text}`);
      return;
    }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? sql.length;
    const next = `${sql.slice(0, start)}${text}${sql.slice(end)}`;
    setSql(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const explain = response?.explain;

  return (
    <div className="panel-body" data-testid="query-inspector">
      <div className="catalog" data-testid="query-catalog">
        <span className="eyebrow">Catalog</span>
        <div className="op-chips">
          {CATALOG.map((t) => (
            <button
              key={t.name}
              type="button"
              className={openTable === t.name ? "chip-toggle active mono" : "chip-toggle mono"}
              title={t.note}
              onClick={() => setOpenTable(openTable === t.name ? null : t.name)}
            >
              {t.name}
            </button>
          ))}
        </div>
        {openTable && (
          <div className="catalog-cols">
            <p className="hint">{CATALOG.find((t) => t.name === openTable)?.note}</p>
            <div className="op-chips">
              {CATALOG.find((t) => t.name === openTable)?.columns.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className="col-chip"
                  title={`insert ${c.name} at the caret`}
                  onClick={() => insertAtCaret(c.name)}
                >
                  <span className="mono">{c.name}</span>
                  <span className="col-type">{c.type}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="hint">{CATALOG_CAVEAT}</p>
      </div>

      <div className="op-chips">
        {Object.entries(CANONICAL_QUERIES).map(([name, q]) => (
          <button
            key={name}
            type="button"
            className={sql === q ? "chip-toggle active" : "chip-toggle"}
            onClick={() => setSql(q)}
          >
            {name}
          </button>
        ))}
      </div>
      <textarea
        ref={inputRef}
        className="sql-input mono"
        data-testid="sql-input"
        rows={3}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
        aria-label="SQL"
      />
      <div className="op-chips">
        <button
          type="button"
          className="primary"
          disabled={!sessionId || busy}
          data-testid="run-query-button"
          onClick={run}
        >
          Run + EXPLAIN ANALYZE
        </button>
        <button
          type="button"
          className="chip-toggle"
          disabled={!sessionId || busy}
          data-testid="explain-query-button"
          title="Plan and measure at the cursor without registering the query"
          onClick={explainOnly}
        >
          EXPLAIN only
        </button>
      </div>

      <div className="registry" data-testid="query-registry">
        <span className="eyebrow">Registered this session ({registry.length})</span>
        {registry.length === 0 ? (
          <p className="hint">No queries registered for this session yet. Run registers; EXPLAIN only does not.</p>
        ) : (
          <ol className="registry-list">
            {registry.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="registry-row"
                  title={q.sql}
                  onClick={() => setSql(q.sql)}
                >
                  <span className="mono registry-id">#{q.id}</span>
                  <span className="mono registry-sql">{q.sql}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {response?.error && (
        <p className="hint" data-testid="query-error" style={{ color: "var(--danger)" }}>
          {response.error}
        </p>
      )}

      {explain && (
        <div data-testid="query-explain">
          <span className="eyebrow">Physical plan</span>
          <ol className="plan-chain">
            {explain.physical_plan.operators.map((op) => {
              const shared = liveOperatorIds.has(op.operator_id);
              return (
                <li key={op.operator_id} className={shared ? "shared" : undefined}>
                  <div className="plan-row">
                    <button
                      type="button"
                      className={selectedOperator === op.operator_id ? "chip-toggle active mono" : "chip-toggle mono"}
                      data-testid={`query-op-${op.operator_id}`}
                      title={shared ? "shared with the live pipeline; click to select it in the DAG" : "planner-only, interpreted"}
                      onClick={() => {
                        if (!shared) return;
                        selectOperator(selectedOperator === op.operator_id ? null : op.operator_id);
                        setRuntimeTab("pipeline");
                      }}
                    >
                      {op.operator_id}
                    </button>
                    <span className="pill">{op.kind}</span>
                    {shared ? (
                      <span className="pill shared-pill">shared with live DAG</span>
                    ) : (
                      <span className="pill">planner-only</span>
                    )}
                  </div>
                  <p className="plan-detail mono">{op.detail}</p>
                </li>
              );
            })}
          </ol>
          <dl className="policy-list">
            <dt>
              watermark <InfoTip>{TERMS.policy}</InfoTip>
            </dt>
            <dd>{explain.watermark_policy}</dd>
            <dt>
              retention <InfoTip>{TERMS.retention}</InfoTip>
            </dt>
            <dd>{explain.state_retention}</dd>
            <dt>
              partitioning <InfoTip>{TERMS.partitioning}</InfoTip>
            </dt>
            <dd>{explain.partitioning}</dd>
          </dl>
          <span className="eyebrow">
            Optimized logical plan{" "}
            <InfoTip>
              The optimizer pushes the filter below the window and prunes the scan to the columns
              the plan reads. Compare with the unoptimized tree below.
            </InfoTip>
          </span>
          <pre className="plan-tree mono">{explain.optimized_logical_plan}</pre>
          <button type="button" className="link-button" onClick={() => setShowLogical((v) => !v)}>
            {showLogical ? "hide unoptimized plan" : "show unoptimized plan"}
          </button>
          {showLogical && <pre className="plan-tree mono">{explain.logical_plan}</pre>}
          {!response?.result && explain.analyze && <Funnel metrics={explain.analyze} testId="query-metrics" />}
        </div>
      )}

      {response?.result && (
        <div data-testid="query-result">
          <span className="eyebrow">
            Result <span className="muted">({response.result.rows.length} rows at the cursor)</span>
          </span>
          <div className="result-wrap">
            <table className="score-table result-table">
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
          <Funnel metrics={response.result.metrics} testId="query-metrics" />
        </div>
      )}
    </div>
  );
}

// EXPLAIN ANALYZE cardinality per stage, as a funnel against rows_scanned.
function Funnel({ metrics, testId }: { metrics: ExplainOutput["analyze"] & object; testId: string }) {
  const base = Math.max(1, metrics.rows_scanned);
  const rows: Array<[string, number]> = [
    ["rows_scanned", metrics.rows_scanned],
    ["rows_after_filter", metrics.rows_after_filter],
    ["rows_out", metrics.rows_out],
  ];
  return (
    <div className="funnel" data-testid={testId}>
      <span className="eyebrow">Cardinality</span>
      {rows.map(([k, v]) => (
        <div className="funnel-row" key={k}>
          <span className="mono q-key">{k}</span>
          <span className="mini-bar wide" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (v / base) * 100)}%` }} />
          </span>
          <span className="mono q-val">{fmtCount(v)}</span>
        </div>
      ))}
      <div className="funnel-row">
        <span className="mono q-key">wall_time_us</span>
        <span />
        <span className="mono q-val">{fmtCount(metrics.wall_time_us)}</span>
      </div>
    </div>
  );
}
