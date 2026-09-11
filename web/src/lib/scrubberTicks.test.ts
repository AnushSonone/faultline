import { describe, expect, it } from "vitest";
import { thinTicks, type TickNode } from "./scrubberTicks";

const toFrac = (ns: number) => ns / 1000;

const node = (id: string, kind: string, time_ns: number): TickNode => ({ id, kind, time_ns });

describe("thinTicks", () => {
  it("keeps every tick when they are already spread out", () => {
    const nodes = [
      node("a", "change", 0),
      node("b", "metric_anomaly", 400),
      node("c", "service_degradation", 800),
    ];
    expect(thinTicks(nodes, toFrac).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps one per bucket and prefers the landmark kind", () => {
    // Four nodes inside the same bucket; the deploy wins.
    const nodes = [
      node("m1", "metric_anomaly", 500),
      node("m2", "metric_anomaly", 501),
      node("d", "change", 502),
      node("g", "service_degradation", 503),
    ];
    const out = thinTicks(nodes, toFrac);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("d");
  });

  it("drops candidates and nodes without a time", () => {
    const nodes = [
      node("c", "root_cause_candidate", 100),
      { id: "n", kind: "metric_anomaly", time_ns: null },
      node("k", "metric_anomaly", 900),
    ];
    expect(thinTicks(nodes, toFrac).map((n) => n.id)).toEqual(["k"]);
  });

  it("caps the total and keeps the result in time order", () => {
    const nodes: TickNode[] = [];
    for (let i = 0; i < 300; i++) nodes.push(node(`m${i}`, "metric_anomaly", i * 3));
    nodes.push(node("late-deploy", "change", 999));
    const out = thinTicks(nodes, toFrac, { max: 10 });
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.map((n) => n.time_ns!)).toEqual([...out.map((n) => n.time_ns!)].sort((a, b) => a - b));
    // the one landmark survives the cap
    expect(out.some((n) => n.id === "late-deploy")).toBe(true);
  });

  it("thins a dense run to at most one per bucket", () => {
    const nodes: TickNode[] = [];
    for (let i = 0; i < 40; i++) nodes.push(node(`m${i}`, "metric_anomaly", i * 20));
    const out = thinTicks(nodes, toFrac);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.length).toBeGreaterThan(5);
  });

  it("drops the anomaly firehose and keeps the landmarks", () => {
    const nodes: TickNode[] = [];
    for (let i = 0; i < 1451; i++) nodes.push(node(`m${i}`, "metric_anomaly", i));
    for (let i = 0; i < 12; i++) nodes.push(node(`d${i}`, "service_degradation", i * 80));
    const out = thinTicks(nodes, toFrac);
    expect(out.every((n) => n.kind === "service_degradation")).toBe(true);
    expect(out).toHaveLength(12);
  });

  it("keeps a handful of anomalies when they are not a firehose", () => {
    const nodes = [
      ...Array.from({ length: 6 }, (_, i) => node(`m${i}`, "metric_anomaly", 100 + i * 90)),
      ...Array.from({ length: 3 }, (_, i) => node(`d${i}`, "service_degradation", 200 + i * 200)),
    ];
    expect(thinTicks(nodes, toFrac).length).toBe(9);
  });
});
