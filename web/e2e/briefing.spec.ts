import { test, expect } from "@playwright/test";

test.describe("Briefing before the replay", () => {
  // The story card and the tour are designed for the three-column layout; short
  // viewports trim the rail.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows the scenario, plays on its button, comes back on demand, resets on incident switch", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("connection")).toContainText("connected", { timeout: 30_000 });
    await expect(page.getByTestId("verdict-hero")).toContainText("Most likely culprit", { timeout: 20_000 });

    const briefing = page.getByTestId("briefing");
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText("recommendationservice");
    await expect(briefing).toContainText("Watch for:");


    // Tour: five steps, each outlining one panel.
    await page.getByTestId("briefing-tour").click();
    const tourCard = page.getByTestId("tour-card");
    await expect(tourCard).toBeVisible();
    await expect(tourCard).toContainText("step 1 of 6");
    await expect(tourCard).toContainText("many small programs");
    await expect(page.locator(".tour-target")).toHaveCount(0);
    await page.getByTestId("tour-next").click();
    await expect(tourCard).toContainText("step 2 of 6");
    await expect(page.locator(".stage-map")).toHaveClass(/tour-target/);
    for (let i = 0; i < 3; i++) await page.getByTestId("tour-next").click();
    await expect(tourCard).toContainText("step 5 of 6");
    await expect(page.getByTestId("verdict-rail")).toHaveClass(/tour-target/);
    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-done")).toBeVisible();
    await page.getByTestId("tour-done").click();
    await expect(tourCard).toHaveCount(0);
    await expect(page.locator(".tour-target")).toHaveCount(0);

    // The tour closes the briefing; the verdict explains itself in words.
    await expect(page.getByTestId("verdict-why")).toBeVisible();
    await expect(page.getByTestId("verdict-why")).toContainText("most likely culprit");

    // Bring the briefing back; its own Play button starts the replay and
    // swaps in the narration.
    await page.getByTestId("briefing-open").click();
    await expect(briefing).toBeVisible();
    await page.getByTestId("briefing-play").click();
    await expect(page.getByTestId("replay-state")).toContainText(/playing/, { timeout: 10_000 });
    await expect(briefing).toHaveCount(0);
    await expect(page.getByTestId("now-strip")).toBeVisible();
    await page.getByTestId("replay-controls").getByRole("button", { name: "Pause", exact: true }).click();

    // The chip brings it back; Skip closes it without playing.
    await page.getByTestId("briefing-open").click();
    await expect(briefing).toBeVisible();
    await page.getByTestId("briefing-skip").click();
    await expect(briefing).toHaveCount(0);

    // A new incident gets its own briefing.
    await page.getByTestId("incident-picker").selectOption("eval-cpu-cart-007", { timeout: 20_000 });
    await expect(page.getByTestId("briefing")).toContainText("cartservice", { timeout: 30_000 });
  });
});
