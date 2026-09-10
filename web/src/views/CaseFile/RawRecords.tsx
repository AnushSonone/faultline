import { useEffect, useMemo, useRef, useState } from "react";
import { runQuery } from "../../api/client";
import { fmtCount } from "../../lib/format";
import {
  DEFAULT_ROW_LIMIT,
  formatCell,
  orderColumns,
  ROW_TABLES,
  rowsSql,
  type RowTable,
} from "../../lib/rowsSql";
import { useCursorTick } from "../../lib/useCursorTick";
import { useInvestigation } from "../../state/investigation";

type Props = { sessionId: string | null; startNs: number | null };

type Result = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  matched: number;
};

const EMPTY_DEPLOYMENTS =
  "No change events in this fixture. RCAEval recordings carry none, which is why change_proximity contributes nothing on the real cases.";

// The rows themselves: what the engine reads, at the replay cursor, from the
// same SQL subset the Runtime tab exposes. One query per view, re-run on a
// cursor throttle; stale responses are dropped by sequence number.
export function RawRecords({ sessionId, startNs }: Props) {
  const [table, setTable] = useState<RowTable["table"]>("metrics");
  const [service, setService] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const tick = useCursorTick(2000);
  const topology = useInvestigation((s) => s.topology);
  const selectTrace = useInvestigation((s) => s.selectTrace);
  const setTab = useInvestigation((s) => s.setTab);
  const setRuntimeTab = useInvestigation((s) => s.setRuntimeTab);
  const seedQuery = useInvestigation((s) => s.seedQuery);

  const services = useMemo(
    () => (topology?.graph.nodes ?? []).map((n) => n.service).sort(),
    [topology],
  );
  const spec = ROW_TABLES.find((t) => t.table === table)!;
  const sql = rowsSql(table, service || null);

  // Switching signal or service drops the old rows at once: a table must
  // never show one query's rows under another query's header. A cursor
  // refresh keeps them, so the rows do not flicker while the replay runs.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [table, service, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const mine = ++seq.current;
    setBusy(true);
    runQuery(sessionId, sql)
      .then((res) => {
        if (seq.current !== mine) return;
        setBusy(false);
        if (res.error) {
          setError(res.error);
          setResult(null);
          return;
        }
        const rows = res.result?.rows ?? [];
        const m = res.result?.metrics;
        setError(null);
        setResult({
          columns: orderColumns(table, res.result?.columns ?? []),
          rows,
          // A filtered plan reports the matches; an unfiltered one only scans.
          matched: (m?.rows_after_filter || m?.rows_scanned) ?? rows.length,
        });
      })
      .catch((e) => {
        if (seq.current !== mine) return;
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [sessionId, sql, table, tick]);

  const openInWorkbench = () => {
    seedQuery(sql);
    setRuntimeTab("queries");
    setTab("runtime");
  };

  const rows = result?.rows ?? [];

  return (
    <div className="raw-rows" data-testid="case-rows">
      <div className="rows-controls">
        <div className="op-chips" role="tablist" aria-label="Signal">
          {ROW_TABLES.map((t) => (
            <button
              key={t.table}
              type="button"
              role="tab"
              aria-selected={t.table === table}
              className={t.table === table ? "chip-toggle active" : "chip-toggle"}
              data-testid={`case-rows-tab-${t.table}`}
              onClick={() => setTable(t.table)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          className="speed-select rows-service"
          data-testid="case-rows-service"
          aria-label="Service filter"
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">all services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <p className="rows-note">{spec.note}</p>

      {error && <p className="hint">Query failed: {error}</p>}

      {!error && busy && result == null && <p className="hint">Reading rows at the cursor…</p>}

      {!error && !busy && rows.length === 0 && (
        <p className="hint" data-testid="case-rows-empty">
          {table === "deployments" ? EMPTY_DEPLOYMENTS : "No rows at the cursor yet. Press Play or seek forward."}
        </p>
      )}

      {rows.length > 0 && result && (
        <div className="rows-wrap">
          <table className="telemetry-table" data-testid="case-rows-table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const traceId = typeof row.trace_id === "string" ? row.trace_id : null;
                return (
                  <tr
                    key={i}
                    className={traceId ? "clickable" : undefined}
                    onClick={
                      traceId
                        ? () => {
                            selectTrace(traceId);
                            setTab("signals");
                          }
                        : undefined
                    }
                    title={traceId ? "Open this trace in Telemetry" : undefined}
                  >
                    {result.columns.map((c) => {
                      const cell = formatCell(c, row[c], startNs);
                      return (
                        <td key={c} className="mono" title={cell.title}>
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="rows-foot">
        {rows.length > 0 && (
          <span>
            newest {Math.min(rows.length, DEFAULT_ROW_LIMIT)} of {fmtCount(result?.matched ?? 0)} rows at the
            cursor ·{" "}
          </span>
        )}
        <code className="mono rows-sql" title={sql}>
          {sql}
        </code>{" "}
        <button type="button" className="link-button" data-testid="case-rows-open" onClick={openInWorkbench}>
          open in the query workbench
        </button>
      </p>
    </div>
  );
}
