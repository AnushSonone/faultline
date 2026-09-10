import { test, expect } from "@playwright/test";
import { bootAtEnd } from "./utils/boot";

test.describe("M5 trace comparison + evidence graph", () => {
  test("critical path, healthy comparison, evidence graph, component filter", async ({
    page,
  }) => {
    // Seek to the incident end: full evidence without pressing Play.
    await bootAtEnd(page);

    // Evidence graph lives on the stage, always visible.
    await expect(page.getByTestId("evidence-graph")).toBeVisible();
    await page.getByTestId("evidence-graph-strongest").click();
    await page.getByTestId("evidence-graph-strongest").click();

    // Clicking a score component filters the evidence list (spec 20.6).
    await page.getByTestId("tab-root-causes").click();
    await expect(page.getByTestId("page-root-causes")).toBeVisible();
    const top = page.locator("[data-testid^='root-cause-']").first();
    if (await top.count()) {
      await top.click();
      const componentRow = page.getByTestId("score-component-anomaly_strength").first();
      await componentRow.click();
      await expect(page.getByText(/evidence filtered to/)).toBeVisible();
    }

    // Trace waterfall: select an error trace, toggle critical path + compare.
    await page.getByTestId("tab-signals").click();
    await expect(page.getByTestId("page-signals")).toBeVisible();
    await expect(page.getByTestId("waterfall")).toBeVisible();
    const select = page.getByTestId("trace-select");
    await expect(select).toBeVisible();
    await expect(page.getByTestId("trace-selected")).toBeVisible({ timeout: 10_000 });
    const failed = await select
      .locator("optgroup[label^='Failed'] option")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const all = await select
      .locator("option")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    let comparisonSeen = false;
    // Failed traces first, then from the end: error traces occur late.
    for (const id of [...failed, ...all.slice().reverse()]) {
      if (comparisonSeen) break;
      await select.selectOption(id);
      const compareToggle = page.getByTestId("waterfall-compare-toggle");
      if (await compareToggle.isVisible({ timeout: 1_500 }).catch(() => false)) {
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
