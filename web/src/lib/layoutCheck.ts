// Dev/test-only label collision guard for the cytoscape canvases. The DOM
// side of the same check lives in e2e/utils/overlap.ts.
import type { Core } from "cytoscape";
import { overlappingPairs } from "./evidenceLayout";

const ROOT_ID = "faultline-demo-root";

export function layoutCheckEnabled(): boolean {
  if (typeof document === "undefined") return false;
  if (import.meta.env.DEV) return true;
  return document.getElementById(ROOT_ID)?.hasAttribute("data-layout-check") ?? false;
}

export type LabelBox = { id: string; x0: number; x1: number; y0: number; y1: number };

export function cyLabelBoxes(cy: Core): LabelBox[] {
  const out: LabelBox[] = [];
  cy.nodes().forEach((n) => {
    if (!n.visible()) return;
    const bb = n.boundingBox({ includeLabels: true, includeOverlays: false });
    out.push({ id: n.id(), x0: bb.x1, x1: bb.x2, y0: bb.y1, y1: bb.y2 });
  });
  return out;
}

// Returns the overlapping pairs and warns once per distinct set.
const lastReport = new Map<string, string>();
export function checkCyLabels(cy: Core, name: string): Array<[string, string]> {
  const pairs = overlappingPairs(cyLabelBoxes(cy));
  const key = pairs.map((p) => p.join("~")).join(",");
  if (lastReport.get(name) !== key) {
    lastReport.set(name, key);
    if (pairs.length > 0) {
      console.warn(`[faultline layout] ${name}: ${pairs.length} overlapping label pair(s)`, pairs);
    }
  }
  return pairs;
}

// Test hook: expose the cytoscape instance on its container so Playwright can
// read label boxes. Never set in the production embed.
export function exposeForTests(container: HTMLElement, cy: Core) {
  if (!layoutCheckEnabled()) return;
  (container as HTMLElement & { __cy?: Core }).__cy = cy;
}
