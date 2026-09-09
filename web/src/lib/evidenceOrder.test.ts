import { describe, expect, it } from "vitest";
import { stableServiceOrder } from "./evidenceOrder";
import type { LayoutNode } from "./evidenceLayout";

const T = 1700000000000000000;
const S = 1e9;

function cand(service: string, rank: number, strength: number, time?: number): LayoutNode {
  return {
    id: `cand:${service}`,
    kind: "root_cause_candidate",
    service,
    label: `#${rank} likely cause: ${service}`,
    strength,
    time_ns: time,
  };
}
function deg(service: string, time: number): LayoutNode {
  return { id: `deg:${service}`, kind: "service_degradation", service, label: `${service} degradation`, strength: 1, time_ns: time };
}

describe("stableServiceOrder", () => {
  it("keeps tied candidates in a fixed order even when rank numbers flip", () => {
    const frameA = [cand("frontend", 1, 0), cand("checkoutservice", 2, 0), cand("cartservice", 3, 0)];
    const frameB = [cand("cartservice", 1, 0), cand("frontend", 2, 0), cand("checkoutservice", 3, 0)];
    const first = stableServiceOrder([], frameA);
    expect(first).toEqual(["cartservice", "checkoutservice", "frontend"]);
    expect(stableServiceOrder(first, frameB)).toEqual(first);
    expect(stableServiceOrder(first, frameA)).toEqual(first);
  });

  it("ignores sub-threshold wobbles and honours material changes", () => {
    const prev = ["checkoutservice", "frontend"];
    const wobble = [cand("checkoutservice", 2, 0.46, T + 7 * S), cand("frontend", 1, 0.48, T + 7 * S)];
    expect(stableServiceOrder(prev, wobble)).toEqual(prev);
    const material = [cand("checkoutservice", 2, 0.40, T + 7 * S), cand("frontend", 1, 0.48, T + 7 * S)];
    expect(stableServiceOrder(prev, material)).toEqual(["frontend", "checkoutservice"]);
  });

  it("slots a strong newcomer at the top without reshuffling the others", () => {
    const prev = ["cartservice", "checkoutservice", "frontend"];
    const nodes = [
      cand("cartservice", 2, 0),
      cand("checkoutservice", 3, 0),
      cand("frontend", 4, 0),
      cand("recommendationservice", 1, 0.45, T + 5 * S),
      deg("recommendationservice", T + 5 * S),
    ];
    expect(stableServiceOrder(prev, nodes)).toEqual([
      "recommendationservice",
      "cartservice",
      "checkoutservice",
      "frontend",
    ]);
  });

  it("puts ranked services before unranked ones, unranked by first appearance", () => {
    const nodes = [deg("paymentservice", T + 9 * S), deg("adservice", T + 8 * S), cand("currencyservice", 1, 0.39, T + 7 * S)];
    expect(stableServiceOrder([], nodes)).toEqual(["currencyservice", "adservice", "paymentservice"]);
  });

  it("drops services that disappeared and reproduces the guided final order", () => {
    const prev = ["zombie", "frontend"];
    const nodes = [
      cand("recommendationservice", 1, 0.86, T + 5 * S),
      cand("checkoutservice", 2, 0.48, T + 7 * S),
      cand("frontend", 3, 0.46, T + 7 * S),
    ];
    const order = stableServiceOrder(prev, nodes);
    expect(order).not.toContain("zombie");
    // frontend survives from prev; the newcomers slot around it by strength,
    // then the 0.02 gap between checkout and frontend is below hysteresis, so
    // insertion order decides: checkout (0.48) goes ahead of frontend (0.46).
    expect(order).toEqual(["recommendationservice", "checkoutservice", "frontend"]);
    expect(stableServiceOrder([], nodes)).toEqual(["recommendationservice", "checkoutservice", "frontend"]);
  });
});
