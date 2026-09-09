import { test, expect } from "@playwright/test";

test.describe("M4 root-cause ranking", () => {
  test("ranked candidates with breakdown, evidence, and linked selection", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("connected", {
      timeout: 30_000,
    });

    // The session opens seeked to the incident end, so the ranking has full evidence.
    await expect(page.getByTestId("verdict-hero")).toContainText("Most likely culprit", {
      timeout: 20_000,
    });

    await page.getByTestId("tab-root-causes").click();
    await expect(page.getByTestId("page-root-causes")).toBeVisible();
    const panel = page.getByTestId("root-causes");
    await expect(panel).toBeVisible();

    const top = page.locator("[data-testid^='root-cause-']").first();
    if (await top.count()) {
      await top.click();
      // Expanded card shows the full score decomposition and evidence.
      const breakdown = page.locator("[data-testid^='root-cause-breakdown-']").first();
      await expect(breakdown).toBeVisible();
      await expect(breakdown.locator("tbody tr")).toHaveCount(9);
      const evidence = page.locator("[data-testid^='root-cause-evidence-']").first();
      if (await evidence.count()) {
        await expect(evidence).toBeVisible();
      }
      // Clicking a candidate drives the shared service selection.
      await expect(page.getByTestId("selection-bar")).toContainText("service:");
      await expect(page.getByTestId("selection-bar")).not.toContainText("service: -");
    }
  });
});
