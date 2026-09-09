import { describe, expect, it } from "vitest";
import { candidateRank, plainMetric, shortEvidenceLabel, truncateLabel } from "./labels";

describe("shortEvidenceLabel", () => {
  it("compresses metric anomalies to metric and z", () => {
    expect(
      shortEvidenceLabel({
        kind: "metric_anomaly",
        service: "recommendationservice",
        label: "recommendationservice_latency anomaly (peak |z| 8.0)",
      }),
    ).toBe("latency spike (z 8.0)");
    expect(
      shortEvidenceLabel({
        kind: "metric_anomaly",
        service: "frontend",
        label: "frontend_error_rate anomaly (peak |z| 8.0)",
      }),
    ).toBe("error rate spike (z 8.0)");
  });
  it("uses the service name for degradations", () => {
    expect(
      shortEvidenceLabel({
        kind: "service_degradation",
        service: "checkoutservice",
        label: "checkoutservice degradation",
      }),
    ).toBe("checkoutservice");
  });
  it("keeps rank and service for candidates", () => {
    expect(
      shortEvidenceLabel({
        kind: "root_cause_candidate",
        service: "recommendationservice",
        label: "#1 likely cause: recommendationservice",
      }),
    ).toBe("#1 recommendationservice");
  });
  it("rewrites change and log prefixes", () => {
    expect(
      shortEvidenceLabel({ kind: "change", label: "change on recommendationservice" }),
    ).toBe("deploy: recommendationservice");
    expect(
      shortEvidenceLabel({
        kind: "log_pattern",
        label: "high-severity log on recommendationservice",
      }),
    ).toBe("error log: recommendationservice");
  });
  it("passes unknown kinds through", () => {
    expect(shortEvidenceLabel({ kind: "other", label: "as is" })).toBe("as is");
  });
});

describe("plainMetric", () => {
  it("maps metric names to plain phrases", () => {
    expect(plainMetric("latency")).toBe("got slower");
    expect(plainMetric("latency-50")).toBe("got slower");
    expect(plainMetric("latency-99")).toBe("got slower");
    expect(plainMetric("mem")).toBe("used more memory");
    expect(plainMetric("memory")).toBe("used more memory");
    expect(plainMetric("error rate")).toBe("threw more errors");
    expect(plainMetric("error_rate")).toBe("threw more errors");
    expect(plainMetric("cpu")).toBe("CPU maxed out");
    expect(plainMetric("workload")).toBe("got busier");
    expect(plainMetric("disk io")).toBe("disk io went strange");
  });
});

describe("truncateLabel", () => {
  it("adds an ellipsis only when needed", () => {
    expect(truncateLabel("short", 10)).toBe("short");
    expect(truncateLabel("recommendationservice", 8)).toBe("recomme…");
  });
});

describe("candidateRank", () => {
  it("parses the rank", () => {
    expect(candidateRank("#3 likely cause: frontend")).toBe(3);
    expect(candidateRank("frontend degradation")).toBeNull();
  });
});

describe("shortEvidenceLabel compact", () => {
  it("drops the service from changes, logs and candidates", () => {
    expect(
      shortEvidenceLabel(
        { kind: "change", service: "recommendationservice", label: "change on recommendationservice" },
        { compact: true },
      ),
    ).toBe("new version");
    expect(
      shortEvidenceLabel(
        { kind: "log_pattern", service: "recommendationservice", label: "high-severity log on recommendationservice" },
        { compact: true },
      ),
    ).toBe("error in logs");
    expect(
      shortEvidenceLabel(
        { kind: "root_cause_candidate", service: "frontend", label: "#3 likely cause: frontend" },
        { compact: true },
      ),
    ).toBe("suspect #3");
  });
  it("falls back to the full form when a candidate label does not parse", () => {
    expect(shortEvidenceLabel({ kind: "root_cause_candidate", label: "odd label" }, { compact: true })).toBe(
      "odd label",
    );
  });
  it("says anomalies in plain words (the tooltip keeps metric and z) and leaves degradations alone", () => {
    const anomaly = { kind: "metric_anomaly", service: "frontend", label: "frontend_latency anomaly (peak |z| 8.0)" };
    expect(shortEvidenceLabel(anomaly, { compact: true })).toBe("got slower");
    expect(shortEvidenceLabel(anomaly)).toBe("latency spike (z 8.0)");
    const deg = { kind: "service_degradation", service: "frontend", label: "frontend degradation" };
    expect(shortEvidenceLabel(deg, { compact: true })).toBe("frontend");
  });
  it("keeps the count suffix and summary precedence", () => {
    expect(
      shortEvidenceLabel(
        { kind: "metric_anomaly", service: "a", label: "a_cpu anomaly (peak |z| 8.0)", count: 47 },
        { compact: true },
      ),
    ).toBe("CPU maxed out ×47");
    expect(
      shortEvidenceLabel({ kind: "change", label: "change on a", summary: "as written" }, { compact: true }),
    ).toBe("as written");
  });
  it("non-compact output is unchanged", () => {
    expect(shortEvidenceLabel({ kind: "change", label: "change on a" })).toBe("deploy: a");
    expect(shortEvidenceLabel({ kind: "root_cause_candidate", label: "#1 likely cause: a" })).toBe("#1 a");
  });
});
