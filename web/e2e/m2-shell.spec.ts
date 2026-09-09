import { test, expect } from "@playwright/test";

test.describe("M2 investigation shell", () => {
  test("loads, plays, and keeps linked selection controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("selection-bar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Faultline" })).toBeVisible();
    // Ground truth is hidden outside evaluation mode (M4 exit criterion).
    await expect(page.getByTestId("ground-truth")).toHaveCount(0);
    await expect(page.getByTestId("connection")).toContainText("connected", {
      timeout: 30_000,
    });

    await page.getByTestId("replay-controls").getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("replay-state")).toContainText(/playing|paused|stopped|ready/, {
      timeout: 10_000,
    });

    await page.getByTestId("replay-controls").getByRole("button", { name: "Pause", exact: true }).click();

    // Stage: service map + the scrubber that is the timeline.
    await expect(page.getByTestId("service-map")).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();

    // Signals drawer: heatmap + waterfall.
    await page.getByTestId("tab-signals").click();
    await expect(page.getByTestId("page-signals")).toBeVisible();
    await expect(page.getByTestId("heatmap")).toBeVisible();
    await expect(page.getByTestId("waterfall")).toBeVisible();
  });
});
