import { describe, expect, it } from "vitest";
import { reconcileSelection, spanDepths, traceExtent, traceStatus } from "./traceSelect";
import type { TraceSpan } from "../types/protocol";

const span = (id: string, parent: string | null, status = "ok", start = 0, end = 10): TraceSpan => ({
  span_id: id,
  parent_span_id: parent,
  service: "svc",
  operation: "op",
  start_time_ns: start,
  end_time_ns: end,
  duration_ns: end - start,
  status,
  missing_parent: false,
});

describe("reconcileSelection", () => {
  it("keeps a selection that is still listed", () => {
    expect(reconcileSelection(["a", "b"], "b", ["a"])).toBe("b");
  });
  it("prefers the first listed failed trace when the selection is stale", () => {
    expect(reconcileSelection(["a", "b", "c"], "zzz", ["c", "b"])).toBe("c");
    expect(reconcileSelection(["a", "b"], null, ["c", "b"])).toBe("b");
  });
  it("falls back to the first listed trace, or null", () => {
    expect(reconcileSelection(["a", "b"], null, [])).toBe("a");
    expect(reconcileSelection([], "a", ["a"])).toBeNull();
  });
});

describe("trace helpers", () => {
  it("derives status, extent and depths", () => {
    const spans = [span("r", null, "ok", 5, 50), span("c", "r", "error", 10, 40), span("g", "c", "ok", 12, 20)];
    expect(traceStatus(spans)).toBe("error");
    expect(traceStatus([])).toBe("unknown");
    expect(traceExtent(spans)).toEqual({ start: 5, end: 50 });
    const d = spanDepths(spans);
    expect(d.get("r")).toBe(0);
    expect(d.get("c")).toBe(1);
    expect(d.get("g")).toBe(2);
  });
  it("treats a missing parent as a root", () => {
    const d = spanDepths([span("x", "ghost")]);
    expect(d.get("x")).toBe(0);
  });
});
