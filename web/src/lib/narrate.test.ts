import { describe, expect, it } from "vitest";
import { sentenceFor } from "./narrate";
import type { NarrationItem } from "./narration";

const item = (kind: string, text: string, service: string | null = "recommendationservice"): NarrationItem => ({
  id: `${kind}:${text}`,
  timeNs: 0,
  kind,
  service,
  text,
});

describe("sentenceFor", () => {
  it("writes one sentence per kind", () => {
    expect(sentenceFor(item("change", "deployment deploy-rec-v2"))).toBe("deployment on recommendationservice");
    expect(sentenceFor(item("log_pattern", "GC pause elevated after deploy"))).toBe(
      "recommendationservice error-log pattern: GC pause elevated after deploy",
    );
    expect(sentenceFor(item("metric_anomaly", "recommendationservice mem spike (z 8.0)"))).toBe(
      "recommendationservice memory anomaly (robust z 8.0)",
    );
    expect(sentenceFor(item("metric_anomaly", "paymentservice latency-50 spike (z 7.5)", "paymentservice"))).toBe(
      "paymentservice p50 latency anomaly (robust z 7.5)",
    );
    expect(sentenceFor(item("service_degradation", "checkoutservice degraded", "checkoutservice"))).toBe(
      "checkoutservice degradation onset",
    );
    expect(sentenceFor(item("root_cause_candidate", "#1 recommendationservice ranked"))).toBe(
      "recommendationservice ranked candidate #1",
    );
  });
  it("falls back to the raw text", () => {
    expect(sentenceFor(item("something_else", "as is"))).toBe("as is");
    expect(sentenceFor(item("metric_anomaly", "odd label"))).toBe("recommendationservice: odd label");
  });
});
