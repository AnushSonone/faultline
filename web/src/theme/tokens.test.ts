import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLORS, COLORS_LIGHT } from "./tokens";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found in styles.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const cssVar = (name: string) => `--${name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;

describe("color tokens", () => {
  it("mirrors the :root color tokens in styles.css", () => {
    const root = block(":root");
    for (const [name, hex] of Object.entries(COLORS)) {
      expect(root, `${cssVar(name)} should be ${hex}`).toContain(`${cssVar(name)}: ${hex}`);
    }
  });

  it("COLORS_LIGHT has exactly the same keys as COLORS", () => {
    expect(Object.keys(COLORS_LIGHT).sort()).toEqual(Object.keys(COLORS).sort());
  });

  it('mirrors the [data-theme="light"] color tokens in styles.css', () => {
    const light = block('[data-theme="light"]');
    for (const [name, hex] of Object.entries(COLORS_LIGHT)) {
      expect(light, `${cssVar(name)} should be ${hex}`).toContain(`${cssVar(name)}: ${hex}`);
    }
  });
});
