import { describe, expect, it } from "vitest";
import { aggregateRoutes, chainFromTrace, sampleTraceIds } from "./routes";
import type { TraceDetail, TraceSpan } from "../types/protocol";

const span = (id: string, parent: string | null, service: string, start: number, status = "ok"): TraceSpan => ({
  span_id: id,
  parent_span_id: parent,
  service,
  operation: "op",
  start_time_ns: start,
  end_time_ns: start + 10,
  duration_ns: 10,
  status,
  missing_parent: false,
});

const detail = (spans: TraceSpan[], critical?: string[], total = 100): TraceDetail => ({
  dag: { trace_id: "t", spans, incomplete: false },
  critical_path: critical
    ? { span_ids: critical, critical_duration_ns: total, total_duration_ns: total, service_contribution_ns: {} }
    : null,
});

describe("chainFromTrace", () => {
  it("follows the parent chain of the deepest critical span and collapses repeats", () => {
    const d = detail(
      [span("a", null, "frontend", 0), span("b", "a", "checkoutservice", 2), span("c", "b", "checkoutservice", 3), span("d", "c", "recommendationservice", 5)],
      ["d", "a", "c", "b"],
    );
    expect(chainFromTrace(d)).toEqual(["frontend", "checkoutservice", "recommendationservice"]);
  });
  it("does not bounce between a caller and its siblings on the critical path", () => {
    const d = detail(
      [
        span("root", null, "frontend", 0),
        span("p1", "root", "productcatalogservice", 1),
        span("c1", "root", "currencyservice", 3),
        span("k", "root", "checkoutservice", 5),
        span("e", "k", "emailservice", 6),
      ],
      ["root", "p1", "c1", "k", "e"],
    );
    expect(chainFromTrace(d)).toEqual(["frontend", "checkoutservice", "emailservice"]);
  });
  it("walks the deepest parent chain when there is no critical path", () => {
    const d = detail([span("a", null, "frontend", 0), span("b", "a", "cartservice", 1), span("c", "a", "checkoutservice", 2), span("e", "c", "paymentservice", 3)]);
    expect(chainFromTrace(d)).toEqual(["frontend", "checkoutservice", "paymentservice"]);
  });
  it("returns nothing for an empty trace", () => {
    expect(chainFromTrace(detail([]))).toEqual([]);
  });
});

describe("aggregateRoutes", () => {
  it("groups distinct chains with sampled and failed counts, origin route first", () => {
    const viaRec = (status: string, total: number) =>
      detail([span("a", null, "frontend", 0), span("b", "a", "recommendationservice", 1, status)], ["a", "b"], total);
    const viaCart = detail([span("a", null, "frontend", 0), span("b", "a", "cartservice", 1)], ["a", "b"], 40);
    const rows = aggregateRoutes([viaCart, viaCart, viaRec("error", 90), viaRec("ok", 30)], "recommendationservice");
    expect(rows.map((r) => r.key)).toEqual(["frontend>recommendationservice", "frontend>cartservice"]);
    expect(rows[0]).toMatchObject({ sampled: 2, failed: 1, throughOrigin: true, medianDurationNs: 30 });
    expect(rows[1]).toMatchObject({ sampled: 2, failed: 0, throughOrigin: false });
  });
});

describe("sampleTraceIds", () => {
  it("takes listed failed ids first, then spreads through the list", () => {
    const listed = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"];
    const out = sampleTraceIds(listed, ["t7", "zzz", "t2"], 5);
    expect(out.slice(0, 2)).toEqual(["t7", "t2"]);
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBe(5);
    expect(out).toContain("t0");
    expect(out).toContain("t9");
  });
  it("returns the whole list when it is small", () => {
    expect(sampleTraceIds(["a", "b"], [], 8)).toEqual(["a", "b"]);
  });
});
