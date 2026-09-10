import { describe, expect, it } from "vitest";
import { placeCallout } from "./callout";

const card = { width: 340, height: 120 };
const shell = { width: 1400, height: 800 };

describe("placeCallout", () => {
  it("prefers below, then above, then right, then left", () => {
    expect(placeCallout({ left: 500, top: 100, width: 200, height: 100 }, card, shell).side).toBe("below");
    // no room below, room above
    expect(placeCallout({ left: 500, top: 650, width: 200, height: 140 }, card, shell).side).toBe("above");
    // full-height column on the left: neither below nor above, so right
    expect(placeCallout({ left: 8, top: 8, width: 300, height: 784 }, card, shell).side).toBe("right");
    // full-height column on the right: left
    expect(placeCallout({ left: 1000, top: 8, width: 392, height: 784 }, card, shell).side).toBe("left");
  });

  it("centres on the spot and clamps into the shell", () => {
    const p = placeCallout({ left: 0, top: 100, width: 100, height: 40 }, card, shell);
    expect(p.side).toBe("below");
    expect(p.left).toBe(8);
    expect(p.top).toBe(152);
    // the pointer still points at the spot centre (x=50), clear of the corner
    expect(p.pointer).toBe(42);
    const far = placeCallout({ left: 1380, top: 100, width: 20, height: 40 }, card, shell);
    expect(far.left).toBe(1400 - 340 - 8);
    expect(far.pointer).toBe(340 - 14);
  });

  it("centres the card in the shell when there is no spot", () => {
    const p = placeCallout(null, card, shell);
    expect(p.side).toBe("center");
    expect(p.left).toBe(530);
    expect(p.top).toBe(340);
  });

  it("falls back to below and clamps when nothing fits", () => {
    const p = placeCallout({ left: 8, top: 8, width: 1384, height: 784 }, card, shell);
    expect(p.side).toBe("below");
    expect(p.top).toBe(800 - 120 - 8);
  });
});
