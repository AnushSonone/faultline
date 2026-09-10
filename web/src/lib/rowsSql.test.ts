import { describe, expect, it } from "vitest";
import { formatCell, orderColumns, rowsSql } from "./rowsSql";

describe("rowsSql", () => {
  it("selects the catalog columns newest first with a limit", () => {
    expect(rowsSql("metrics", null)).toBe(
      "SELECT event_time, service, name, value FROM metrics ORDER BY event_time DESC LIMIT 25",
    );
    expect(rowsSql("logs", null, 5)).toBe(
      "SELECT event_time, service, severity, body FROM logs ORDER BY event_time DESC LIMIT 5",
    );
  });

  it("filters by service and escapes quotes", () => {
    expect(rowsSql("spans", "cartservice", 10)).toContain("WHERE service = 'cartservice'");
    expect(rowsSql("metrics", "o'brien")).toContain("WHERE service = 'o''brien'");
  });
});

describe("orderColumns", () => {
  it("puts the alphabetical response back into catalog order and keeps extras", () => {
    expect(orderColumns("spans", ["duration_ns", "event_time", "operation", "service", "status", "trace_id"])).toEqual([
      "event_time",
      "service",
      "operation",
      "duration_ns",
      "status",
      "trace_id",
    ]);
    expect(orderColumns("logs", ["body", "event_time", "extra", "service"])).toEqual([
      "event_time",
      "service",
      "body",
      "extra",
    ]);
  });
});

describe("formatCell", () => {
  it("renders event time as an offset and keeps the raw nanoseconds", () => {
    const c = formatCell("event_time", 1700000005000000000, 1700000000000000000);
    expect(c.text).toBe("t+5.0s");
    expect(c.title).toBe("1700000005000000000 ns");
  });

  it("renders durations, trace ids and floats compactly", () => {
    expect(formatCell("duration_ns", 104000, null).text).toBe("104 µs");
    const t = formatCell("trace_id", "f24a325fa1b61ea8793c1cb638b60325", null);
    expect(t.text).toBe("…b60325");
    expect(t.title).toBe("f24a325fa1b61ea8793c1cb638b60325");
    expect(formatCell("value", 0.6798864811563414, null).text).toBe("0.6799");
    expect(formatCell("value", 49856512, null).text).toBe("49856512");
    expect(formatCell("value", 0.0000123, null).text).toBe("1.23e-5");
  });

  it("passes text through and reports nulls", () => {
    expect(formatCell("severity", "ERROR", null).text).toBe("ERROR");
    expect(formatCell("value", null, null).text).toBe("null");
  });
});
