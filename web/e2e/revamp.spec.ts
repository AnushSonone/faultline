import { test, expect } from "@playwright/test";

test.describe("UI revamp: verdict-first open + case panel", () => {
  test("opens on the verdict, gates the answer behind reveal", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection")).toContainText("connected", {
      timeout: 30_000,
    });

    // Verdict-first: the session opens seeked to the incident end, so the
    // cursor is not at t+0 and the ranked verdict is already populated.
    await expect(page.getByTestId("scrubber-time")).not.toHaveText("0.0 s in", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("verdict-hero")).toContainText("Most likely culprit", {
      timeout: 15_000,
    });

    // Ground-truth toast stays hidden (M4 exit criterion, unchanged).
    await expect(page.getByTestId("ground-truth")).toHaveCount(0);

    // Case drawer: brief always visible, answer absent until revealed.
    await page.getByTestId("tab-case").click();
    await expect(page.getByTestId("page-case")).toBeVisible();
    await expect(page.getByTestId("case-panel")).toBeVisible();
    await expect(page.getByTestId("case-answer")).toHaveCount(0);

    await page.getByTestId("case-reveal-button").click();
    await expect(page.getByTestId("case-answer")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("case-answer")).toContainText("fixture ground truth");

    // Play rewinds to the start and replays.
    await page.getByTestId("replay-controls").getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("replay-state")).toContainText(/playing/, {
      timeout: 10_000,
    });
  });

  test("incident picker swaps the scenario and reloads the session", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("connection")).toContainText("connected", {
      timeout: 30_000,
    });

    // Default incident: the guided rec-mem scenario briefing is in the case drawer.
    await page.getByTestId("tab-case").click();
    await expect(page.getByTestId("scenario-blurb")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("scenario-blurb")).toContainText(
      "recommendationservice",
    );

    // Switch to a tracked eval-suite case (the RCAEval fixtures are local-only,
    // so CI does not have them). The whole session recreates, so give the
    // create + load + verdict-seek path generous time.
    await page
      .getByTestId("incident-picker")
      .selectOption("eval-cpu-cart-007", { timeout: 20_000 });
    await expect(page.getByTestId("scenario-blurb")).toContainText("cartservice", {
      timeout: 20_000,
    });

    // Verdict hero repopulates from the new session's evidence.
    await page.getByTestId("tab-overview").click();
    await expect(page.getByTestId("verdict-hero")).toContainText("Most likely culprit", {
      timeout: 20_000,
    });

    // The case brief and runtime status reflect the newly loaded incident.
    await page.getByTestId("tab-case").click();
    await expect(page.getByTestId("case-panel")).toBeVisible();
    await page.getByTestId("tab-runtime").click();
    await expect(page.getByTestId("arch-status")).toContainText("eval-cpu-cart-007", {
      timeout: 20_000,
    });
  });
});
