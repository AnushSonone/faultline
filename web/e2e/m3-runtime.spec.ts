import { test, expect } from "@playwright/test";

test.describe("M3 runtime depth", () => {
  test("inspector, percentiles, correlation, mode switch, reset", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("connected", {
      timeout: 30_000,
    });
    // The session opens seeked to the incident end, so evidence is complete.
    await expect(page.getByTestId("scrubber-time")).not.toHaveText("0.0 s in", {
      timeout: 15_000,
    });

    // Runtime drawer: inspector + arch status.
    await page.getByTestId("tab-runtime").click();
    await expect(page.getByTestId("page-runtime")).toBeVisible();
    const inspector = page.getByTestId("runtime-inspector");
    await expect(inspector).toBeVisible();
    await inspector.locator("summary").click();
    await expect(page.getByTestId("inspector-overview")).toBeVisible();
    await expect(page.getByTestId("inspector-operator-graph")).toBeVisible();

    const op = page.getByTestId("op-latency_percentile");
    if (await op.count()) {
      await op.click();
      await expect(page.getByTestId("operator-detail")).toBeVisible();
    }

    await expect(page.getByTestId("wm-timeline")).toBeVisible();
    await expect(page.getByTestId("arch-status")).toContainText("streaming percentile");
    await expect(page.getByTestId("arch-status")).toContainText("evidence ranking");

    // Signals drawer: heatmap shows p99 cells at the end state.
    await page.getByTestId("tab-signals").click();
    await expect(page.getByTestId("heatmap")).toBeVisible();
    const p99 = page.getByTestId("heatmap-p99-cell");
    if (await p99.count()) {
      // The latest bucket keeps the cursor past the deploy, so the correlation card below still exists.
      await p99.last().click();
    }

    // Score-breakdown drawer: correlation card links back to the join operator.
    await page.getByTestId("tab-root-causes").click();
    const corr = page.getByTestId("deployment-correlation");
    await expect(corr).toBeVisible();
    const card = page.locator("[data-testid^='correlation-']").first();
    if (await card.count()) {
      await card.click();
      await page.getByTestId("tab-runtime").click();
      await expect(page.getByTestId("runtime-inspector")).toBeVisible();
      await page.getByTestId("runtime-inspector").locator("summary").click();
      await expect(page.getByTestId("op-deploy_temporal_join")).toBeVisible();
    }

    // Engine menu: heatmap projection mode toggle.
    await page.locator(".engine-menu summary").click();
    await page.getByTestId("heatmap-mode-toggle").click();
    await expect(page.getByTestId("heatmap-mode")).toContainText(/precomputed|streaming/);

    await page.getByTestId("replay-controls").getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByTestId("replay-state")).toBeVisible();
  });
});
