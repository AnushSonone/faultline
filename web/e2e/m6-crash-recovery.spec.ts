import { test, expect } from "@playwright/test";
import { bootAtEnd } from "./utils/boot";
import { switchRuntimeTab } from "./utils/runtime";

test.describe("M6 checkpoint + recovery", () => {
  test("checkpoint, forced crash, recovery without duplicates", async ({ page }) => {
    // Seek past the incident so there is state worth checkpointing.
    await bootAtEnd(page);

    await page.getByTestId("tab-runtime").click();
    await expect(page.getByTestId("page-runtime")).toBeVisible();
    await switchRuntimeTab(page, "recovery");
    await expect(page.getByTestId("crash-test")).toBeVisible();
    await page.getByTestId("checkpoint-button").click();
    await expect(page.getByTestId("checkpoint-info")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("checkpoint-info")).toContainText("last checkpoint");

    // Forced crash + recovery.
    await page.getByTestId("crash-test-button").click();
    await expect(page.getByTestId("recovery-report")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("duplicate-check")).toContainText(
      "no duplicate evidence after recovery",
    );
    await expect(page.getByTestId("recovery-state")).toContainText("recovered");

    // Session still live: replay controls respond and projections flow.
    await expect(page.getByTestId("connection")).toContainText("connected");
    await page.getByTestId("tab-root-causes").click();
    await expect(page.getByTestId("root-causes")).toBeVisible();
    await expect(page.locator("[data-testid^='root-cause-']").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
