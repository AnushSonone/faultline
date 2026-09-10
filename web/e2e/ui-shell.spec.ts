import { test, expect } from "@playwright/test";
import { bootAtEnd } from "./utils/boot";

test.describe("UI shell: dock tabs + scrubber", () => {
  test("tab switching, scrubber seek, speed select", async ({ page }) => {
    await bootAtEnd(page);

    // The stage is always on screen; every other tab opens its drawer.
    await expect(page.getByTestId("page-overview")).toBeVisible();
    for (const tab of ["root-causes", "signals", "case", "runtime"] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.getByTestId(`page-${tab}`)).toBeVisible();
      await expect(page.getByTestId("page-overview")).toBeVisible();
    }
    await page.getByTestId("tab-overview").click();
    await expect(page.getByTestId("verdict-rail")).toBeVisible();
    await expect(page.getByTestId("page-root-causes")).toHaveCount(0);

    // Service map survives a drawer round-trip (cytoscape resize).
    await expect(page.getByTestId("service-map")).toBeVisible();

    // Scrubber seek: click at 60% and the cursor time updates.
    const before = await page.getByTestId("scrubber-time").innerText();
    const scrubber = page.getByTestId("timeline");
    const box = await scrubber.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
      await expect(page.getByTestId("scrubber-time")).not.toHaveText(before, {
        timeout: 5_000,
      });
    }

    // Speed select round-trips without error.
    await page.getByTestId("speed-select").selectOption("50");
    await expect(page.getByTestId("speed-select")).toHaveValue("50");

    // Drawer switch does not kill the session.
    await page.getByTestId("tab-signals").click();
    await expect(page.getByTestId("connection")).toContainText("connected");

    // Escape closes the drawer.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("page-signals")).toHaveCount(0);
  });
});
