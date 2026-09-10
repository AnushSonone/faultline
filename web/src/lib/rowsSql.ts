// The raw-records browser in the Case file: which columns each table shows,
// the SQL that fetches them, and how a cell is rendered. Pure, so the query
// text and the formatting are unit-tested.
//
// The tables mirror crates/planner/src/catalog.rs (see content/catalog.ts).
// `incidents` is left out: the V1 planner always returns zero rows for it.

import { fmtDurationNs, fmtOffset, shortTraceId } from "./format";

export type RowTable = {
  table: "metrics" | "spans" | "logs" | "deployments";
  label: string;
  // Catalog order, which is not the order the API returns (it sorts the
  // response columns alphabetically).
  columns: string[];
  note: string;
};

export const ROW_TABLES: RowTable[] = [
  {
    table: "metrics",
    label: "metrics",
    columns: ["event_time", "service", "name", "value"],
    note: "One row per metric sample. Units differ per fixture, so the value is shown raw beside its series name.",
  },
  {
    table: "spans",
    label: "spans",
    columns: ["event_time", "service", "operation", "duration_ns", "status", "trace_id"],
    note: "One row per span. Rows are clickable: the trace opens in Telemetry.",
  },
  {
    table: "logs",
    label: "logs",
    columns: ["event_time", "service", "severity", "body"],
    note: "One row per log line, at the severity the source emitted.",
  },
  {
    table: "deployments",
    label: "deployments",
    columns: ["event_time", "service", "change_id", "change_type", "version_after"],
    note: "One row per change event. RCAEval recordings contain none.",
  },
];

export const DEFAULT_ROW_LIMIT = 25;

function quote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

// Newest first at the cursor. ORDER BY requires a LIMIT in this SQL subset,
// and there is no server-side row cap, so the LIMIT is never optional.
export function rowsSql(
  table: RowTable["table"],
  service: string | null,
  limit: number = DEFAULT_ROW_LIMIT,
): string {
  const spec = ROW_TABLES.find((t) => t.table === table);
  const cols = (spec?.columns ?? ["event_time", "service"]).join(", ");
  const where = service ? ` WHERE service = ${quote(service)}` : "";
  return `SELECT ${cols} FROM ${table}${where} ORDER BY event_time DESC LIMIT ${limit}`;
}

// The response lists its columns alphabetically; show them in catalog order,
// and keep any column the server sent that we did not ask for.
export function orderColumns(table: RowTable["table"], returned: string[]): string[] {
  const spec = ROW_TABLES.find((t) => t.table === table);
  const wanted = spec?.columns ?? [];
  const known = wanted.filter((c) => returned.includes(c));
  const extra = returned.filter((c) => !wanted.includes(c));
  return [...known, ...extra];
}

export type Cell = { text: string; title?: string };

function fmtFloat(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(2);
  return String(Number(n.toPrecision(4)));
}

// One cell, formatted for a narrow column with the exact value on hover.
// event_time arrives as epoch nanoseconds in a JSON number, which is past the
// safe integer range: values land on a 256 ns grid. That is invisible at the
// granularity shown here.
export function formatCell(column: string, value: unknown, startNs: number | null): Cell {
  if (value == null) return { text: "null" };
  if (column === "event_time" && typeof value === "number") {
    return { text: fmtOffset(value, startNs), title: `${value} ns` };
  }
  if (column === "duration_ns" && typeof value === "number") {
    return { text: fmtDurationNs(value), title: `${value} ns` };
  }
  if (column === "trace_id" && typeof value === "string") {
    return { text: shortTraceId(value), title: value };
  }
  if (typeof value === "number") {
    const text = fmtFloat(value);
    return { text, title: text === String(value) ? undefined : String(value) };
  }
  const text = String(value);
  return { text, title: text.length > 24 ? text : undefined };
}
