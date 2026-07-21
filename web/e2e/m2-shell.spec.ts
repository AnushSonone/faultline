import { test, expect } from "@playwright/test";

test.describe("M2 investigation shell", () => {
  test("loads controls and selection bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("selection-bar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Faultline" })).toBeVisible();
  });
});
