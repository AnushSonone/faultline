import { test, expect } from "@playwright/test";

test.describe("M2 investigation shell", () => {
  test("loads, plays, and keeps linked selection controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("selection-bar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Faultline" })).toBeVisible();
    await expect(page.getByTestId("ground-truth")).toContainText("not inferred");
    await expect(page.getByTestId("connection")).toContainText("ws live", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByTestId("replay-state")).toContainText(/playing|paused|stopped/, {
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByTestId("heatmap")).toBeVisible();
    await expect(page.getByTestId("service-map")).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.getByTestId("waterfall")).toBeVisible();
  });
});
