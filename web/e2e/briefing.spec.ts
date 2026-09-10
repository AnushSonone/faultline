import { test, expect } from "@playwright/test";
import { bootAtStart, dismissFirstVisit, seekToEnd } from "./utils/boot";

test.describe("Investigation-first open", () => {
  // The case brief and the walkthrough are designed for the three-column layout; short
  // viewports trim the rail.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("first visit, case brief, walkthrough, brief comes back, resets on incident switch", async ({ page }) => {
    await bootAtStart(page, { keepFirstVisit: true });

    // Nothing is ranked at boot; the choice card sits over the stage.
    await expect(page.getByTestId("first-visit")).toBeVisible();
    await expect(page.getByTestId("verdict-hero")).toContainText("Nothing is ranked yet");
    await dismissFirstVisit(page);

    const briefing = page.getByTestId("briefing");
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText("recommendationservice");
    await expect(briefing).toContainText("Watch");
    const checklist = page.getByTestId("checklist");
    await expect(checklist).toBeVisible();
    await expect(checklist.locator("[data-testid^='check-']")).toHaveCount(6);
    await expect(checklist.locator("[data-done='true']")).toHaveCount(0);

    // Walkthrough: one spotlight per step; steps 2 and 5 also outline a panel.
    await page.getByTestId("briefing-tour").click();
    const tourCard = page.getByTestId("tour-card");
    await expect(tourCard).toBeVisible();
    await expect(tourCard).toContainText("step 1 of 13");
    await expect(tourCard).toContainText("streaming root-cause analysis");
    await expect(page.locator(".tour-target")).toHaveCount(0);
    await page.getByTestId("tour-next").click();
    await expect(tourCard).toContainText("step 2 of 13");
    await expect(page.locator(".stage-map")).toHaveClass(/tour-target/);
    for (let i = 0; i < 3; i++) await page.getByTestId("tour-next").click();
    await expect(tourCard).toContainText("step 5 of 13");
    await expect(page.getByTestId("verdict-rail")).toHaveClass(/tour-target/);
    // The evidence steps seek the replay to the end.
    await expect(page.getByTestId("scrubber-time")).not.toHaveText("0.0 s in", { timeout: 15_000 });
    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-done")).toBeVisible();
    await page.getByTestId("tour-done").click();
    await expect(tourCard).toHaveCount(0);
    await expect(page.locator(".tour-target")).toHaveCount(0);

    // Closing the tour resets the replay and ticks nothing.
    await expect(page.getByTestId("scrubber-time")).toHaveText("0.0 s in", { timeout: 10_000 });
    await expect(checklist.locator("[data-done='true']")).toHaveCount(0);

    // Seeked to the end, the verdict explains itself in words.
    await seekToEnd(page);
    await expect(page.getByTestId("verdict-why")).toBeVisible();
    await expect(page.getByTestId("verdict-why")).toContainText("top root-cause candidate");

    // Bring the brief back; its own Run replay button starts the replay and
    // swaps in the evidence timeline.
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

    // A new incident gets its own brief, and no second first-visit card.
    await page.getByTestId("incident-picker").selectOption("eval-cpu-cart-007", { timeout: 20_000 });
    await expect(page.getByTestId("briefing")).toContainText("cartservice", { timeout: 30_000 });
    await expect(page.getByTestId("first-visit")).toHaveCount(0);
  });

  test("the first-visit choice is remembered per browser and can be forced back", async ({ page }) => {
    await bootAtStart(page, { keepFirstVisit: true });
    await page.getByTestId("first-visit-tour").click();
    await expect(page.getByTestId("tour-card")).toContainText("step 1 of 13");
    await expect(page.getByTestId("briefing")).toHaveCount(0);
    await page.getByTestId("tour-done").click();
    await expect(page.getByTestId("tour-card")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("connection")).toContainText("connected", { timeout: 40_000 });
    await expect(page.getByTestId("replay-state")).toContainText("ready", { timeout: 40_000 });
    await expect(page.getByTestId("first-visit")).toHaveCount(0);

    // Clearing the visited flag brings the choice back on the next load.
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.getByTestId("first-visit")).toBeVisible({ timeout: 40_000 });
    // The permanent button lives in the transport bar.
    await dismissFirstVisit(page);
    await page.getByTestId("tour-open").click();
    await expect(page.getByTestId("tour-card")).toContainText("step 1 of 13");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour-card")).toHaveCount(0);
  });

  test("the checklist ticks as the visitor investigates", async ({ page }) => {
    await bootAtStart(page);
    const row = (id: string) => page.getByTestId(`check-${id}`);

    // The drawer replaces the rail, so the checklist is read back on Overview.
    await row("case").locator("button").click();
    await expect(page.getByTestId("page-case")).toBeVisible();
    await page.getByTestId("tab-overview").click();
    await expect(row("case")).toHaveAttribute("data-done", "true");

    await expect(row("truth")).toHaveAttribute("data-locked", "true");
    await page.getByTestId("speed-select").selectOption("50");
    await page.getByTestId("replay-controls").getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("replay-state")).toContainText(/playing/, { timeout: 10_000 });
    await expect(page.getByTestId("replay-state")).toContainText(/ready/, { timeout: 40_000 });

    // Once the ranking exists the checklist folds to one line; expand it.
    const checklist = page.getByTestId("checklist");
    await expect(checklist).toBeVisible();
    if (await page.getByTestId("checklist-toggle").isVisible()) {
      await page.getByTestId("checklist-toggle").click();
    }
    await expect(checklist.locator("[data-testid^='check-']")).toHaveCount(6);
    await expect(row("replay")).toHaveAttribute("data-done", "true");
    await expect(row("graph")).toHaveAttribute("data-done", "true", { timeout: 10_000 });
    await expect(row("ranking")).toHaveAttribute("data-done", "true", { timeout: 10_000 });
    await expect(row("truth")).not.toHaveAttribute("data-locked", "true");

    await row("telemetry").locator("button").click();
    await expect(page.getByTestId("page-signals")).toBeVisible();
    await page.getByTestId("tab-overview").click();
    if (await page.getByTestId("checklist-toggle").isVisible()) {
      await page.getByTestId("checklist-toggle").click();
    }
    await expect(row("telemetry")).toHaveAttribute("data-done", "true");

    await row("truth").locator("button").click();
    await expect(page.getByTestId("page-case")).toBeVisible();
    await expect(page.getByTestId("case-reveal-button")).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId("case-reveal-button").click();
    await expect(page.getByTestId("case-answer")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("tab-overview").click();
    if (await page.getByTestId("checklist-toggle").isVisible()) {
      await page.getByTestId("checklist-toggle").click();
    }
    await expect(row("truth")).toHaveAttribute("data-done", "true");
    await expect(checklist.locator("[data-done='true']")).toHaveCount(6);
  });
});
