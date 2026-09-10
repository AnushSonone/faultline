import { describe, expect, it } from "vitest";
import { bucketSizeS, faultMetricLike, faultMetricName, metricNameFor, parseSeriesRows, seriesSql } from "./series";

const scenario = (source: "synthetic" | "rcaeval-re2ob", signal: "memory" | "cpu" | "latency") => ({
  source,
  schematic: { origin: "recommendationservice", signal, waves: [], edges: [], injectedAtS: 5 },
});

describe("metric names", () => {
  it("follows the fixture naming per fault kind and source", () => {
    expect(faultMetricName(scenario("synthetic", "memory"))).toBe("recommendationservice_mem");
    expect(faultMetricName(scenario("synthetic", "cpu"))).toBe("recommendationservice_cpu");
    expect(faultMetricName(scenario("synthetic", "latency"))).toBe("recommendationservice_latency");
    expect(faultMetricName(scenario("rcaeval-re2ob", "latency"))).toBe("recommendationservice_latency-50");
    expect(metricNameFor("frontend", scenario("rcaeval-re2ob", "latency"))).toBe("frontend_latency-50");
    expect(faultMetricLike("memory")).toBe("%mem%");
  });
});

describe("seriesSql", () => {
  it("reads raw rows for short recordings", () => {
    expect(seriesSql("recommendationservice", "recommendationservice_mem", 15)).toBe(
      "SELECT event_time, value FROM metrics WHERE service = 'recommendationservice' AND name = 'recommendationservice_mem' LIMIT 4000",
    );
  });
  it("buckets long recordings with TUMBLE and AVG", () => {
    expect(bucketSizeS(15)).toBeNull();
    expect(bucketSizeS(1440)).toBe(8);
    expect(bucketSizeS(400)).toBe(2);
    expect(seriesSql("svc", "%mem%", 1440, { like: true })).toBe(
      "SELECT TUMBLE(event_time, '8s') AS t, AVG(value) AS v FROM metrics WHERE service = 'svc' AND name LIKE '%mem%' GROUP BY service LIMIT 400",
    );
  });
  it("escapes quotes", () => {
    expect(seriesSql("a'b", "n", 10)).toContain("service = 'a''b'");
  });
});

describe("parseSeriesRows", () => {
  it("accepts raw and bucketed shapes and sorts by time", () => {
    expect(parseSeriesRows([{ event_time: 30, value: "2" }, { event_time: 10, value: 1 }])).toEqual([
      { t: 10, v: 1 },
      { t: 30, v: 2 },
    ]);
    expect(parseSeriesRows([{ t: 8, v: 0.5 }, { window_start: 0, v: 0.25 }, { t: null, v: 1 }])).toEqual([
      { t: 0, v: 0.25 },
      { t: 8, v: 0.5 },
    ]);
  });
});
