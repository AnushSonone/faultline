import { describe, expect, it } from "vitest";
import {
  fmtBytes,
  fmtCount,
  fmtDurationNs,
  fmtOffset,
  fmtPct,
  shortTraceId,
  titleCase,
} from "./format";

describe("fmtOffset", () => {
  it("formats seconds with one decimal under 100s", () => {
    expect(fmtOffset(41.2e9, 0)).toBe("t+41.2s");
    expect(fmtOffset(12.4e9 + 5e9, 5e9)).toBe("t+12.4s");
  });

  it("drops the decimal at 100s and above", () => {
    expect(fmtOffset(99.9e9, 0)).toBe("t+99.9s");
    expect(fmtOffset(100e9, 0)).toBe("t+100s");
    expect(fmtOffset(312e9, 0)).toBe("t+312s");
  });

  it("switches to minutes at 600s", () => {
    expect(fmtOffset(599e9, 0)).toBe("t+599s");
    expect(fmtOffset(600e9, 0)).toBe("t+10m 00s");
    expect(fmtOffset(725e9, 0)).toBe("t+12m 05s");
  });

  it("clamps offsets below the start to t+0.0s", () => {
    expect(fmtOffset(5e9, 10e9)).toBe("t+0.0s");
  });

  it("returns a dash when either argument is missing", () => {
    expect(fmtOffset(null, 0)).toBe("-");
    expect(fmtOffset(undefined, 0)).toBe("-");
    expect(fmtOffset(10e9, null)).toBe("-");
    expect(fmtOffset(10e9, undefined)).toBe("-");
  });
});

describe("fmtDurationNs", () => {
  it("picks a unit so the mantissa stays in range", () => {
    expect(fmtDurationNs(840)).toBe("840 ns");
    expect(fmtDurationNs(1_200)).toBe("1.2 µs");
    expect(fmtDurationNs(34_000_000)).toBe("34 ms");
    expect(fmtDurationNs(2_100_000_000)).toBe("2.1 s");
  });

  it("handles unit boundaries", () => {
    expect(fmtDurationNs(999)).toBe("999 ns");
    expect(fmtDurationNs(1_000)).toBe("1.0 µs");
    expect(fmtDurationNs(999_000_000)).toBe("999 ms");
    expect(fmtDurationNs(1_000_000_000)).toBe("1.0 s");
  });

  it("returns a dash for missing values", () => {
    expect(fmtDurationNs(null)).toBe("-");
    expect(fmtDurationNs(undefined)).toBe("-");
  });
});

describe("fmtBytes", () => {
  it("formats with 1024-based units", () => {
    expect(fmtBytes(312)).toBe("312 B");
    expect(fmtBytes(3.2 * 1024)).toBe("3.2 KB");
    expect(fmtBytes(4.5 * 1024 * 1024)).toBe("4.5 MB");
  });

  it("handles 1024 boundaries", () => {
    expect(fmtBytes(1023)).toBe("1023 B");
    expect(fmtBytes(1024)).toBe("1.0 KB");
    expect(fmtBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("returns a dash for missing values", () => {
    expect(fmtBytes(null)).toBe("-");
    expect(fmtBytes(undefined)).toBe("-");
  });
});

describe("fmtCount", () => {
  it("adds thousands separators", () => {
    expect(fmtCount(12406)).toBe("12,406");
    expect(fmtCount(999)).toBe("999");
  });

  it("returns a dash for missing values", () => {
    expect(fmtCount(null)).toBe("-");
    expect(fmtCount(undefined)).toBe("-");
  });
});

describe("fmtPct", () => {
  it("formats a fraction as a percentage with one decimal", () => {
    expect(fmtPct(0.267)).toBe("26.7%");
    expect(fmtPct(1)).toBe("100.0%");
  });

  it("returns a dash for missing values", () => {
    expect(fmtPct(null)).toBe("-");
    expect(fmtPct(undefined)).toBe("-");
  });
});

describe("titleCase", () => {
  it("capitalizes only the first character and replaces underscores", () => {
    expect(titleCase("anomaly_strength")).toBe("Anomaly strength");
    expect(titleCase("temporal_precedence")).toBe("Temporal precedence");
  });

  it("preserves embedded numbers", () => {
    expect(titleCase("p99_latency")).toBe("P99 latency");
  });
});

describe("shortTraceId", () => {
  it("shortens long ids to an ellipsis plus the last six chars", () => {
    expect(shortTraceId("9c1d44e2b7f3a91c")).toBe("…f3a91c");
  });

  it("passes short ids through unchanged", () => {
    expect(shortTraceId("ab12cd34")).toBe("ab12cd34");
    expect(shortTraceId("abc")).toBe("abc");
  });
});
