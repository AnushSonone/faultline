import { test, expect } from "@playwright/test";

test.describe("M5 trace comparison + evidence graph", () => {
  test("critical path, healthy comparison, evidence graph, component filter", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("ws live", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Pause" }).click();

    // Evidence graph renders on the root-causes tab.
    await page.getByTestId("tab-root-causes").click();
    await expect(page.getByTestId("evidence-graph")).toBeVisible();
    await page.getByTestId("evidence-graph-strongest").click();

    // Clicking a score component filters the evidence list (spec 20.6).
    const top = page.locator("[data-testid^='root-cause-']").first();
    if (await top.count()) {
      await top.click();
      const componentRow = page.getByTestId("score-component-anomaly_strength").first();
      await componentRow.click();
      await expect(page.getByText(/evidence filtered to/)).toBeVisible();
    }

    // Trace waterfall: select an error trace, toggle critical path + compare.
    await page.getByTestId("tab-signals").click();
    await expect(page.getByTestId("waterfall")).toBeVisible();
    const traceButtons = page.locator(".trace-item");
    const count = await traceButtons.count();
    let comparisonSeen = false;
    // Iterate from the end: error traces occur late in the incident.
    for (let i = count - 1; i >= 0 && !comparisonSeen; i--) {
      await traceButtons.nth(i).click();
      // Let the trace-detail fetch settle so the toolbar reflects this trace.
      await page.waitForTimeout(400);
      const compareToggle = page.getByTestId("waterfall-compare-toggle");
      if (await compareToggle.count()) {
        await page.getByTestId("waterfall-filter-critical").click();
        await compareToggle.click();
        await expect(page.getByTestId("trace-comparison")).toBeVisible();
        await expect(page.getByTestId("trace-comparison")).toContainText("median healthy");
        comparisonSeen = true;
      }
    }
    expect(comparisonSeen, "no failed trace offered a healthy comparison").toBe(true);
  });
});
