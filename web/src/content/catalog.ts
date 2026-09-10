// The five tables the SQL subset knows. Mirrors crates/planner/src/catalog.rs;
// there is no catalog endpoint, so this copy is the reference the workbench
// shows. Keep the two in sync when the planner grows a column.

export type CatalogColumn = { name: string; type: "text" | "float" | "int" | "time" };
export type CatalogTable = { name: string; columns: CatalogColumn[]; note: string };

export const CATALOG: CatalogTable[] = [
  {
    name: "metrics",
    note: "One row per metric sample. `name` is the series (latency, mem, cpu, error_rate).",
    columns: [
      { name: "service", type: "text" },
      { name: "name", type: "text" },
      { name: "value", type: "float" },
      { name: "event_time", type: "time" },
    ],
  },
  {
    name: "spans",
    note: "One row per span. `status` is ok or error; `trace_id` groups a request.",
    columns: [
      { name: "service", type: "text" },
      { name: "operation", type: "text" },
      { name: "duration_ns", type: "int" },
      { name: "status", type: "text" },
      { name: "trace_id", type: "text" },
      { name: "event_time", type: "time" },
    ],
  },
  {
    name: "logs",
    note: "One row per log line. `severity` is the level the source emitted.",
    columns: [
      { name: "service", type: "text" },
      { name: "severity", type: "text" },
      { name: "body", type: "text" },
      { name: "event_time", type: "time" },
    ],
  },
  {
    name: "deployments",
    note: "Change events. The right side of the temporal interval join.",
    columns: [
      { name: "service", type: "text" },
      { name: "change_id", type: "text" },
      { name: "change_type", type: "text" },
      { name: "version_after", type: "text" },
      { name: "event_time", type: "time" },
    ],
  },
  {
    name: "incidents",
    note: "The loaded incident's bounds.",
    columns: [
      { name: "incident_id", type: "text" },
      { name: "start_time", type: "time" },
      { name: "end_time", type: "time" },
    ],
  },
];

export const CATALOG_CAVEAT =
  "Time columns are event time. The planner accepts SELECT, WHERE, TUMBLE windows, P50/P95/P99, AVG, COUNT, an equi-join against deployments, ORDER BY and LIMIT; it rejects DISTINCT, subqueries and non-equi joins.";
