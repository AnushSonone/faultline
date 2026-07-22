import { test, expect } from "@playwright/test";

test.describe("M3 runtime depth", () => {
  test("inspector, percentiles, correlation, mode switch, reset", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("ws live", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Pause" }).click();

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
    await expect(page.getByTestId("arch-status")).toContainText("not implemented");

    // Heatmap may show p99 cells after play.
    const p99 = page.getByTestId("heatmap-p99-cell");
    if (await p99.count()) {
      await p99.first().click();
    }

    const corr = page.getByTestId("deployment-correlation");
    await expect(corr).toBeVisible();
    const card = page.locator("[data-testid^='correlation-']").first();
    if (await card.count()) {
      await card.click();
      await expect(page.getByTestId("op-deploy_temporal_join")).toBeVisible();
    }

    await page.getByTestId("heatmap-mode-toggle").click();
    await expect(page.getByTestId("heatmap-mode")).toContainText(/precomputed|streaming/);

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByTestId("replay-state")).toBeVisible();
  });
});
