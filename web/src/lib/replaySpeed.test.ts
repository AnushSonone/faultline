import { describe, expect, it } from "vitest";
import { pickReplaySpeed } from "./replaySpeed";

const S = 1e9;

describe("pickReplaySpeed", () => {
  it("plays the 15 s guided incident at 1x", () => {
    expect(pickReplaySpeed(15 * S)).toBe("1");
  });
  it("plays a two minute incident at 5x", () => {
    expect(pickReplaySpeed(120 * S)).toBe("5");
  });
  it("plays the 24 minute RE2-OB incidents at 50x", () => {
    expect(pickReplaySpeed(1440 * S)).toBe("50");
  });
  it("falls back to 10x without a span", () => {
    expect(pickReplaySpeed(null)).toBe("10");
    expect(pickReplaySpeed(0)).toBe("10");
    expect(pickReplaySpeed(Number.NaN)).toBe("10");
  });
});
