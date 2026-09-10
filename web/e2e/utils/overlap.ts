import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Label-collision sweep over the embed. Two sources of boxes: DOM text
// elements and cytoscape node+label bounding boxes (via the test hook that
// src/lib/layoutCheck.ts installs as container.__cy). Everything is in
// viewport pixels so the two sets can be compared to each other.

export type Box = {
  id: string;
  text: string;
  group: string; // nearest [data-testid] ancestor, "" when none
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Clipped = { id: string; text: string; scrollWidth: number; clientWidth: number; by?: string };

const ROOT = "#faultline-demo-root";

export async function collectTextBoxes(page: Page): Promise<{ boxes: Box[]; clipped: Clipped[] }> {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    const boxes: Box[] = [];
    const clipped: Clipped[] = [];
    if (!root) return { boxes, clipped };

    const shortPath = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== root && parts.length < 4) {
        const tid = cur.getAttribute("data-testid");
        if (tid) {
          parts.unshift(`[${tid}]`);
          break;
        }
        const cls = cur.classList.length ? `.${cur.classList[0]}` : "";
        parts.unshift(`${cur.tagName.toLowerCase()}${cls}`);
        cur = cur.parentElement;
      }
      return parts.join(">");
    };

    const hiddenBySubtree = (el: Element): boolean => {
      let cur: Element | null = el;
      while (cur && cur !== root) {
        if (cur.getAttribute("aria-hidden") === "true") return true;
        if (cur.tagName === "DETAILS" && !(cur as HTMLDetailsElement).open) {
          // summary is visible in a closed details; its other children are not
          const summary = cur.querySelector(":scope > summary");
          if (!summary || !summary.contains(el)) return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };

    const all = root.querySelectorAll("*");
    for (const el of Array.from(all)) {
      if (el.tagName === "OPTION" || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
      if (el.tagName === "CANVAS") continue;
      let hasText = false;
      let text = "";
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "") {
          hasText = true;
          text += (child.textContent ?? "").trim() + " ";
        }
      }
      if (!hasText) continue;
      if (hiddenBySubtree(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // offscreen / clipped away entirely
      if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;
      const group = (el.closest("[data-testid]") as Element | null)?.getAttribute("data-testid") ?? "";
      const id = shortPath(el);

      // Clip against every overflow ancestor (root included). Fully hidden
      // text is not on screen and cannot overlap anything. Text partially cut
      // by a non-scrolling overflow:hidden ancestor is a defect in its own
      // right; a scrolling container legitimately cuts rows at its edge.
      let x0 = r.left;
      let y0 = r.top;
      let x1 = r.right;
      let y1 = r.bottom;
      let hiddenCutBy: string | null = null;
      let anc: Element | null = el.parentElement;
      while (anc) {
        const acs = getComputedStyle(anc);
        const clipsX = acs.overflowX !== "visible";
        const clipsY = acs.overflowY !== "visible";
        if (clipsX || clipsY) {
          const ar = anc.getBoundingClientRect();
          const nx0 = clipsX ? Math.max(x0, ar.left) : x0;
          const nx1 = clipsX ? Math.min(x1, ar.right) : x1;
          const ny0 = clipsY ? Math.max(y0, ar.top) : y0;
          const ny1 = clipsY ? Math.min(y1, ar.bottom) : y1;
          const scrollable = ["auto", "scroll"].includes(acs.overflowX) || ["auto", "scroll"].includes(acs.overflowY);
          const cut = nx0 > x0 + 1 || nx1 < x1 - 1 || ny0 > y0 + 1 || ny1 < y1 - 1;
          if (cut && !scrollable && nx1 > nx0 && ny1 > ny0 && !hiddenCutBy) {
            hiddenCutBy = shortPath(anc) || anc.tagName.toLowerCase();
          }
          x0 = nx0;
          x1 = nx1;
          y0 = ny0;
          y1 = ny1;
        }
        if (anc === root) break;
        anc = anc.parentElement;
      }
      if (x1 - x0 <= 1 || y1 - y0 <= 1) continue; // nothing of it is on screen
      if (hiddenCutBy) {
        clipped.push({ id, text: text.trim().slice(0, 60), scrollWidth: Math.round(r.width), clientWidth: Math.round(x1 - x0), by: hiddenCutBy });
      }
      boxes.push({ id, text: text.trim().slice(0, 60), group, x0, y0, x1, y1 });

      if (cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre") {
        const he = el as HTMLElement;
        if (he.scrollWidth > he.clientWidth + 1 && cs.textOverflow !== "ellipsis" && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
          clipped.push({ id, text: text.trim().slice(0, 60), scrollWidth: he.scrollWidth, clientWidth: he.clientWidth });
        }
      }
    }
    return { boxes, clipped };
  }, ROOT);
}

export async function collectCyBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Box[] = [];
    const containers = document.querySelectorAll(".graph-canvas, .evidence-canvas");
    for (const c of Array.from(containers)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (c as any).__cy;
      if (!cy) continue;
      const cs = getComputedStyle(c);
      if (cs.display === "none") continue;
      if (c.closest('[aria-hidden="true"]')) continue;
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const z = cy.zoom();
      const p = cy.pan();
      const group = (c.closest("[data-testid]") as Element | null)?.getAttribute("data-testid") ?? "cy";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cy.nodes().forEach((n: any) => {
        if (!n.visible()) return;
        const op = Number(n.effectiveOpacity?.() ?? n.style("opacity") ?? 1);
        if (op === 0) return;
        const bb = n.boundingBox({ includeLabels: true, includeOverlays: false });
        const x0 = r.left + bb.x1 * z + p.x;
        const x1 = r.left + bb.x2 * z + p.x;
        const y0 = r.top + bb.y1 * z + p.y;
        const y1 = r.top + bb.y2 * z + p.y;
        // only what is actually inside the (possibly scrolling) canvas viewport
        const scroller = c.parentElement;
        const sr = scroller ? scroller.getBoundingClientRect() : r;
        if (y1 < sr.top || y0 > sr.bottom) return;
        out.push({ id: `${group}:${n.id()}`, text: String(n.data("label") ?? n.id()), group: `${group}:cy`, x0, y0, x1, y1 });
      });
    }
    return out;
  });
}

export function overlappingPairs(boxes: Box[], tolerance = 1): Array<[Box, Box]> {
  const out: Array<[Box, Box]> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const hit =
        a.x0 + tolerance < b.x1 && b.x0 + tolerance < a.x1 && a.y0 + tolerance < b.y1 && b.y0 + tolerance < a.y1;
      if (hit) out.push([a, b]);
    }
  }
  return out;
}

function contains(outer: Box, inner: Box, tol = 1): boolean {
  return outer.x0 <= inner.x0 + tol && outer.y0 <= inner.y0 + tol && outer.x1 >= inner.x1 - tol && outer.y1 >= inner.y1 - tol;
}

export type OverlapOptions = {
  viewportWidth: number;
  /** extra pair filter; return true to ignore the pair */
  ignore?: (a: Box, b: Box) => boolean;
};

export async function assertNoOverlap(page: Page, stateName: string, opts: OverlapOptions) {
  // let animations (rank reorder, node fade-in) settle
  await page.waitForTimeout(450);
  const { boxes: dom, clipped } = await collectTextBoxes(page);
  const cy = await collectCyBoxes(page);
  const all = [...dom, ...cy];

  const pairs = overlappingPairs(all).filter(([a, b]) => {
    if (contains(a, b) || contains(b, a)) return false;
    // siblings inside one component are laid out by flex/grid on purpose
    if (a.group !== "" && a.group === b.group) return false;
    if (opts.ignore?.(a, b)) return false;
    return true;
  });

  mkdirSync("test-results/layout", { recursive: true });
  await page.screenshot({ path: `test-results/layout/${opts.viewportWidth}-${stateName}.png` });

  const lines: string[] = [];
  for (const [a, b] of pairs) {
    lines.push(
      `  overlap: ${a.id} "${a.text}" [${Math.round(a.x0)},${Math.round(a.y0)}-${Math.round(a.x1)},${Math.round(a.y1)}] × ${b.id} "${b.text}" [${Math.round(b.x0)},${Math.round(b.y0)}-${Math.round(b.x1)},${Math.round(b.y1)}]`,
    );
  }
  for (const c of clipped) {
    lines.push(
      c.by
        ? `  cut off: ${c.id} "${c.text}" (${c.clientWidth}px of ${c.scrollWidth}px visible) by overflow:hidden ${c.by}`
        : `  clipped: ${c.id} "${c.text}" scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth}`,
    );
  }
  expect(lines, `[${opts.viewportWidth}px / ${stateName}] label problems:\n${lines.join("\n")}`).toEqual([]);

  const scroll = await page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel) as HTMLElement | null;
    const se = document.scrollingElement as HTMLElement;
    return {
      rootScrollH: root?.scrollHeight ?? 0,
      rootClientH: root?.clientHeight ?? 0,
      rootScrollW: root?.scrollWidth ?? 0,
      rootClientW: root?.clientWidth ?? 0,
      pageScrollW: se.scrollWidth,
      innerW: window.innerWidth,
    };
  }, ROOT);
  if (opts.viewportWidth >= 1000) {
    expect(
      scroll.rootScrollH,
      `[${opts.viewportWidth}px / ${stateName}] root scrolls vertically (${scroll.rootScrollH} > ${scroll.rootClientH})`,
    ).toBeLessThanOrEqual(scroll.rootClientH + 1);
    expect(
      scroll.rootScrollW,
      `[${opts.viewportWidth}px / ${stateName}] root scrolls horizontally (${scroll.rootScrollW} > ${scroll.rootClientW})`,
    ).toBeLessThanOrEqual(scroll.rootClientW + 1);
  }
  expect(
    scroll.pageScrollW,
    `[${opts.viewportWidth}px / ${stateName}] page scrolls horizontally`,
  ).toBeLessThanOrEqual(scroll.innerW + 1);

  // Frame: the embed must sit inside the viewport with a gutter on every
  // side (4rem by design at >= 1000px, a narrower one below). Scroll so the
  // root's own top margin is in view, then measure.
  const frame = await page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel) as HTMLElement | null;
    if (!root) return null;
    window.scrollTo(0, Math.max(0, root.offsetTop - 64));
    const r = root.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      height: Math.round(r.height),
      innerW: window.innerWidth,
      innerH: window.innerHeight,
    };
  }, ROOT);
  expect(frame, `[${opts.viewportWidth}px / ${stateName}] root not found for frame check`).not.toBeNull();
  if (frame) {
    const rect = `left ${frame.left}, right ${frame.right}, top ${frame.top}, height ${frame.height}, viewport ${frame.innerW}x${frame.innerH}`;
    const gutter = opts.viewportWidth >= 1000 ? 56 : 20;
    expect(
      frame.left,
      `[${opts.viewportWidth}px / ${stateName}] embed touches the left edge (${rect})`,
    ).toBeGreaterThanOrEqual(gutter);
    expect(
      frame.innerW - frame.right,
      `[${opts.viewportWidth}px / ${stateName}] embed touches the right edge (${rect})`,
    ).toBeGreaterThanOrEqual(gutter);
    if (opts.viewportWidth >= 1000) {
      expect(
        frame.height,
        `[${opts.viewportWidth}px / ${stateName}] embed taller than viewport minus gutters (${rect})`,
      ).toBeLessThanOrEqual(frame.innerH - 112);
    }
  }
}

// The evidence graph fits its width by zooming out, never in. Below this
// zoom its 11px labels stop being readable, so the sweep pins a floor per
// viewport. Skips silently when the canvas has no cytoscape instance (empty
// state, or the test hook is off).
export async function assertEvidenceZoom(page: Page, stateName: string, minZoom: number) {
  const zoom = await page.evaluate(() => {
    const c = document.querySelector(".evidence-canvas");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = (c as any)?.__cy;
    if (!cy) return null;
    const cs = getComputedStyle(c as Element);
    if (cs.display === "none") return null;
    return cy.zoom() as number;
  });
  if (zoom == null) return;
  expect(
    zoom,
    `[${stateName}] evidence graph zoom ${zoom.toFixed(3)} is below the legibility floor ${minZoom}`,
  ).toBeGreaterThanOrEqual(minZoom);
}

// Play-time stability: sample every evidence node's model position while the
// replay runs and fail on direction reversals or perpetual animation. Before
// the queued-animation fix a node reversed dozens of times per replay.
export async function assertPlayStability(page: Page, stateName: string, sampleMs = 100, durationMs = 4000) {
  const samples: Array<Record<string, { x: number; y: number; anim: boolean }>> = [];
  const t0 = Date.now();
  while (Date.now() - t0 < durationMs) {
    const s = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cy = (document.querySelector(".evidence-canvas") as any)?.__cy;
      const out: Record<string, { x: number; y: number; anim: boolean }> = {};
      if (!cy) return out;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cy.nodes().forEach((n: any) => {
        const p = n.position();
        out[n.id()] = { x: p.x, y: p.y, anim: n.animated() };
      });
      return out;
    });
    samples.push(s);
    await page.waitForTimeout(sampleMs);
  }
  const ids = new Set<string>();
  for (const s of samples) for (const id of Object.keys(s)) ids.add(id);
  const problems: string[] = [];
  for (const id of ids) {
    let prev: { x: number; y: number } | null = null;
    let lastDir: { x: number; y: number } | null = null;
    let reversals = 0;
    let animFrames = 0;
    let present = 0;
    const path: string[] = [];
    for (const s of samples) {
      const p = s[id];
      if (!p) continue;
      present++;
      if (p.anim) animFrames++;
      if (prev) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const dir = { x: Math.sign(dx), y: Math.sign(dy) };
          if (lastDir && ((dir.x && lastDir.x && dir.x !== lastDir.x) || (dir.y && lastDir.y && dir.y !== lastDir.y))) {
            reversals++;
          }
          lastDir = dir;
          path.push(`${Math.round(p.x)},${Math.round(p.y)}`);
        }
      }
      prev = p;
    }
    // Two reversals is a legitimate reflow (pushed down by an insertion, then
    // promoted); the queued-animation bug produced dozens.
    if (reversals > 2) problems.push(`${id}: ${reversals} direction reversals (${path.slice(0, 8).join(" → ")})`);
    if (present > 5 && animFrames / present > 0.6) problems.push(`${id}: animating in ${animFrames}/${present} samples`);
  }
  expect(problems, `[${stateName}] evidence nodes oscillate:\n${problems.join("\n")}`).toEqual([]);
}

// The laid-out graph sits horizontally centred in its scroll box.
export async function assertEvidenceCentred(page: Page, stateName: string, tolerancePx = 12) {
  const m = await page.evaluate(() => {
    const canvas = document.querySelector(".evidence-canvas") as HTMLElement | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = (canvas as any)?.__cy;
    const scroll = document.querySelector(".evidence-scroll") as HTMLElement | null;
    if (!cy || !scroll || getComputedStyle(scroll).display === "none") return null;
    const bb = cy.elements().boundingBox({ includeLabels: true });
    const z = cy.zoom();
    const p = cy.pan();
    let left = bb.x1 * z + p.x;
    let right = bb.x2 * z + p.x;
    // The lane headers are part of the picture: include their extents.
    const sr = scroll.getBoundingClientRect();
    for (const head of Array.from(document.querySelectorAll(".lane-head"))) {
      const r = head.getBoundingClientRect();
      left = Math.min(left, r.left - sr.left);
      right = Math.max(right, r.right - sr.left);
    }
    const top = bb.y1 * z + p.y;
    const bottom = bb.y2 * z + p.y;
    return {
      leftGap: left,
      rightGap: scroll.clientWidth - right,
      width: scroll.clientWidth,
      topGap: top,
      bottomGap: scroll.clientHeight - bottom,
      height: scroll.clientHeight,
      fits: bottom - top <= scroll.clientHeight,
    };
  });
  if (!m) return;
  expect(
    Math.abs(m.leftGap - m.rightGap),
    `[${stateName}] evidence graph off-centre: left gap ${Math.round(m.leftGap)}px, right gap ${Math.round(m.rightGap)}px in ${m.width}px`,
  ).toBeLessThanOrEqual(tolerancePx);
  // Only meaningful when the graph is shorter than the box; a taller graph
  // pins to the top and scrolls.
  if (m.fits) {
    expect(
      Math.abs(m.topGap - m.bottomGap),
      `[${stateName}] evidence graph off-centre vertically: top gap ${Math.round(m.topGap)}px, bottom gap ${Math.round(m.bottomGap)}px in ${m.height}px`,
    ).toBeLessThanOrEqual(16);
  }
}
