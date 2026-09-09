import { test, expect } from "@playwright/test";

test.describe("M7 query plan inspector", () => {
  test("run canonical query, see plans, metrics, and result rows", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("connected", {
      timeout: 30_000,
    });

    // The session opens at the incident end, so the query has data at the cursor.
    await expect(page.getByTestId("scrubber-time")).not.toHaveText("0.0 s in", {
      timeout: 15_000,
    });

    await page.getByTestId("tab-runtime").click();
    await expect(page.getByTestId("page-runtime")).toBeVisible();
    await expect(page.getByTestId("query-inspector")).toBeVisible();
    await page.getByTestId("run-query-button").click();

    await expect(page.getByTestId("query-explain")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("query-explain")).toContainText("Aggregate");
    await expect(page.getByTestId("query-explain")).toContainText("latency_percentile");
    await expect(page.getByTestId("query-result")).toBeVisible();
    await expect(page.getByTestId("query-metrics")).toContainText("rows_scanned");

    // Bad SQL surfaces a clear error.
    await page.getByTestId("sql-input").fill("SELECT DISTINCT service FROM metrics");
    await page.getByTestId("run-query-button").click();
    await expect(page.getByTestId("query-error")).toContainText("DISTINCT", {
      timeout: 10_000,
    });
  });
});
