import { describe, expect, it } from "vitest";
import { markVisited, readFirstVisit } from "./firstVisit";

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    map: m,
  };
}

describe("readFirstVisit", () => {
  it("is true on an empty storage and false once marked", () => {
    const s = memStorage();
    expect(readFirstVisit(s)).toBe(true);
    markVisited(s);
    expect(readFirstVisit(s)).toBe(false);
  });
  it("is false when storage is missing or throws, and marking never throws", () => {
    expect(readFirstVisit(null)).toBe(false);
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFirstVisit(bad)).toBe(false);
    expect(() => markVisited(bad)).not.toThrow();
  });
});
