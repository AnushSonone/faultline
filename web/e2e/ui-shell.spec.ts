import { test, expect } from "@playwright/test";

test.describe("UI shell: tabs + scrubber", () => {
  test("tab switching, scrubber seek, speed select", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("ws live", {
      timeout: 30_000,
    });

    // All four tabs render their page.
    for (const tab of ["root-causes", "signals", "runtime", "overview"] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.getByTestId(`page-${tab}`)).toBeVisible();
    }

    // Service map survives a tab round-trip (cytoscape resize on activate).
    await expect(page.getByTestId("service-map")).toBeVisible();

    // Scrubber seek: click at 60% and the cursor time updates.
    const before = await page.getByTestId("scrubber-time").innerText();
    const scrubber = page.getByTestId("replay-scrubber").locator(".scrubber");
    const box = await scrubber.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
      await expect(page.getByTestId("scrubber-time")).not.toHaveText(before, {
        timeout: 5_000,
      });
    }

    // Speed select round-trips without error.
    await page.getByTestId("speed-select").selectOption("60");
    await expect(page.getByTestId("speed-select")).toHaveValue("60");

    // Tab switch does not kill the session.
    await page.getByTestId("tab-signals").click();
    await expect(page.getByTestId("connection")).toContainText("ws live");
  });
});
