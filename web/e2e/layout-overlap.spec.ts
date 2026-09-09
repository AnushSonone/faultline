import { test, expect, type Page } from "@playwright/test";
import { assertEvidenceZoom, assertNoOverlap, assertPlayStability, assertEvidenceCentred } from "./utils/overlap";

// One-screen, no-overlap sweep. Every state the UI can be in, at six
// viewport widths: no two labels may intersect, no nowrap label may be
// clipped without an ellipsis, the root must never gain scrollable overflow
// at >= 1000px wide, the embed keeps a gutter from every screen edge, and
// the evidence graph stays legible (zoom floor).

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1200, height: 800 }, // three-column threshold
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
];

const LOAD_TIMEOUT = 40_000;

async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId("connection")).toContainText("connected", { timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId("verdict-hero")).toContainText("Most likely culprit", {
    timeout: LOAD_TIMEOUT,
  });
  await expect(page.getByTestId("scrubber-time")).not.toHaveText("0.0 s in", { timeout: LOAD_TIMEOUT });
}

async function seekFraction(page: Page, frac: number) {
  const track = page.getByTestId("timeline");
  const box = await track.boundingBox();
  expect(box, "timeline track has a bounding box").not.toBeNull();
  if (!box) return;
  const x = box.x + Math.max(2, Math.min(box.width - 2, box.width * frac));
  await page.mouse.click(x, box.y + box.height / 2);
  // let the seek round-trip and the projections repaint
  await page.waitForTimeout(700);
}

async function openTab(page: Page, tab: string) {
  await page.getByTestId(`tab-${tab}`).click();
  if (tab !== "overview") {
    await expect(page.getByTestId(`page-${tab}`)).toBeVisible({ timeout: 10_000 });
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`layout overlap @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });
    test.setTimeout(240_000);

    test("no overlapping or clipped labels in any state", async ({ page }) => {
      const check = (state: string) => assertNoOverlap(page, state, { viewportWidth: vp.width });

      await boot(page);
      await check("boot");
      await assertEvidenceZoom(page, `${vp.width}px / boot`, vp.width >= 1440 ? 0.75 : 0.55);
      await assertEvidenceCentred(page, `${vp.width}px / boot`);
      // The briefing is open at boot; also check the rail after it is dismissed and re-opened.
      await page.getByTestId("briefing-skip").click();
      await check("briefing-closed");
      await page.getByTestId("briefing-open").click();
      await check("briefing-open");
      if (vp.width === 1024) {
      }
      if (vp.width === 1440) {
        // The tour outlines panels and parks a card in the rail; both must lay out cleanly.
        await page.getByTestId("briefing-tour").click();
        await check("tour-1");
        await page.getByTestId("tour-next").click();
        await page.getByTestId("tour-next").click();
        await page.getByTestId("tour-next").click();
        await check("tour-4");
        await page.getByTestId("tour-next").click();
        await page.getByTestId("tour-next").click();
        await page.getByTestId("tour-done").click();
        // The tour closes the briefing; reopen so later states match the other viewports.
        await page.getByTestId("briefing-open").click();
      }
      if (vp.width === 1440) {
        // Play-time stability: nodes must not oscillate while frames stream
        // in. Seek to just before the onset (t+4.5s of 15s) so the 4 s window
        // covers the deploy, the anomalies and the first promotions.
        const track = page.getByTestId("timeline");
        const box = await track.boundingBox();
        if (box) await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
        await page.waitForTimeout(600);
        await page.getByTestId("replay-controls").getByRole("button", { name: "Play", exact: true }).click();
        await assertPlayStability(page, `${vp.width}px / play-stability`);
        await page.getByTestId("replay-controls").getByRole("button", { name: "Pause", exact: true }).click();
      }

      await seekFraction(page, 0);
      await check("seek-0");
      await seekFraction(page, 0.35);
      await check("seek-35");
      await seekFraction(page, 0.5);
      await check("seek-50");
      await seekFraction(page, 1);
      await check("seek-100");

      // Playing: the guided case runs at 1x, ~15 s wall time.
      await page.getByTestId("replay-controls").getByRole("button", { name: "Play", exact: true }).click();
      await expect(page.getByTestId("replay-state")).toContainText(/playing/, { timeout: 10_000 });
      await page.waitForTimeout(1500);
      await check("playing-1");
      await page.waitForTimeout(3000);
      await check("playing-2");
      await page.getByTestId("replay-controls").getByRole("button", { name: "Pause", exact: true }).click();
      await seekFraction(page, 1);

      // Linked selection from the rank list.
      const firstRank = page.locator("[data-testid^='rank-']").first();
      await expect(firstRank).toBeVisible({ timeout: 10_000 });
      await firstRank.click();
      await check("select-service");

      // Strongest-path filter on the evidence graph.
      await page.getByTestId("evidence-graph-strongest").click();
      await check("strongest-path");
      await page.getByTestId("evidence-graph-strongest").click();

      // Dock drawers, one at a time.
      await openTab(page, "root-causes");
      await expect(page.getByTestId("root-causes")).toBeVisible({ timeout: 10_000 });
      const card = page.locator("[data-testid^='root-cause-']").first();
      if (await card.count()) {
        await card.click();
        const component = page.getByTestId("score-component-anomaly_strength").first();
        if (await component.count()) await component.click();
      }
      await check("tab-root-causes");

      await openTab(page, "signals");
      await expect(page.getByTestId("heatmap")).toBeVisible();
      await expect(page.getByTestId("waterfall")).toBeVisible();
      await check("tab-signals");

      await openTab(page, "case");
      await expect(page.getByTestId("case-panel")).toBeVisible();
      const reveal = page.getByTestId("case-reveal-button");
      if (await reveal.count()) {
        await reveal.click();
        await expect(page.getByTestId("case-answer")).toBeVisible({ timeout: 10_000 });
      }
      await check("tab-case");

      await openTab(page, "runtime");
      await expect(page.getByTestId("crash-test")).toBeVisible();
      const inspector = page.getByTestId("runtime-inspector");
      if (await inspector.count()) {
        await inspector.locator("summary").click();
      }
      await check("tab-runtime");
      await page.getByTestId("crash-test-button").click();
      await expect(page.getByTestId("recovery-report")).toBeVisible({ timeout: 20_000 });
      await check("tab-runtime-recovered");

      await openTab(page, "overview");
      await expect(page.getByTestId("verdict-rail")).toBeVisible();
      await check("tab-overview");
    });

    if (vp.width === 1440) {
      test("real RE2-OB incident (11 services) if served", async ({ page }) => {
        const check = (state: string) =>
          assertNoOverlap(page, `re2ob-${state}`, { viewportWidth: vp.width });

        await boot(page);
        const picker = page.getByTestId("incident-picker");
        const options = await picker.locator("option").allTextContents();
        const values = await picker.locator("option").evaluateAll((els) =>
          els.map((e) => (e as HTMLOptionElement).value),
        );
        const target = "re2ob-emailservice-cpu-1";
        test.skip(!values.includes(target), `${target} is not served (RCAEval fixtures are local-only); options: ${options.join(", ")}`);

        await picker.selectOption(target, { timeout: 20_000 });
        await expect(page.getByTestId("connection")).toContainText("connected", { timeout: LOAD_TIMEOUT });
        await expect(page.getByTestId("verdict-hero")).toContainText("Most likely culprit", {
          timeout: LOAD_TIMEOUT,
        });
        await check("boot");
        await assertEvidenceZoom(page, `${vp.width}px / re2ob-boot`, 0.55);

        await seekFraction(page, 1);
        await check("seek-100");

        // The briefing hides the rank list until dismissed.
        await page.getByTestId("briefing-skip").click();
        const firstRank = page.locator("[data-testid^='rank-']").first();
        await expect(firstRank).toBeVisible({ timeout: 10_000 });
        await firstRank.click();
        await check("select-service");

        await openTab(page, "root-causes");
        await expect(page.getByTestId("root-causes")).toBeVisible({ timeout: 10_000 });
        const card = page.locator("[data-testid^='root-cause-']").first();
        if (await card.count()) await card.click();
        await check("tab-root-causes");
      });
    }
  });
}
