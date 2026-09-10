import { test, expect } from "@playwright/test";
import { switchRuntimeTab } from "./utils/runtime";
import { bootAtEnd, bootAtStart, seekToEnd } from "./utils/boot";

test.describe("UI revamp: investigation-first open + case panel", () => {
  test("seeks to the verdict, gates the answer behind a full replay", async ({ page }) => {
    // Boot at t+0, then seek to the incident end: the ranked verdict populates.
    await bootAtEnd(page);

    // Ground-truth toast stays hidden (M4 exit criterion, unchanged).
    await expect(page.getByTestId("ground-truth")).toHaveCount(0);

    // Case drawer: brief always visible, the ground truth locked until the
    // replay has been played through once.
    await page.getByTestId("tab-case").click();
    await expect(page.getByTestId("page-case")).toBeVisible();
    await expect(page.getByTestId("case-panel")).toBeVisible();
    await expect(page.getByTestId("case-answer")).toHaveCount(0);
    await expect(page.getByTestId("case-reveal-button")).toBeDisabled();

    // Play rewinds to the start and replays; at the top speed the guided case
    // finishes in a few seconds and the transport reads "ready" again.
    await page.getByTestId("speed-select").selectOption("50");
    await page.getByTestId("replay-controls").getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("replay-state")).toContainText(/playing/, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("replay-state")).toContainText(/ready/, { timeout: 40_000 });

    await expect(page.getByTestId("case-reveal-button")).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId("case-reveal-button").click();
    await expect(page.getByTestId("case-answer")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("case-answer")).toContainText("fault-injection label");
  });

  test("raw records browse the real rows at the cursor", async ({ page }) => {
    await bootAtEnd(page);
    await page.getByTestId("tab-case").click();
    const rows = page.getByTestId("case-rows");
    await expect(rows).toBeVisible({ timeout: 15_000 });

    // Metrics: real samples, newest first, with the query that produced them.
    const table = page.getByTestId("case-rows-table");
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table.locator("tbody tr").first()).toBeVisible();
    await expect(rows).toContainText("FROM metrics ORDER BY event_time DESC LIMIT 25");
    await expect(rows).toContainText("rows at the cursor");

    // Logs: the guided fixture has exactly two lines.
    await page.getByTestId("case-rows-tab-logs").click();
    await expect(rows).toContainText("FROM logs", { timeout: 20_000 });
    await expect(page.getByTestId("case-rows-table").locator("tbody tr")).toHaveCount(2, {
      timeout: 20_000,
    });

    // A service filter rewrites the query.
    await page.getByTestId("case-rows-tab-metrics").click();
    await page.getByTestId("case-rows-service").selectOption("recommendationservice");
    await expect(rows).toContainText("WHERE service = 'recommendationservice'", { timeout: 20_000 });

    // The same query opens in the Runtime workbench.
    await page.getByTestId("case-rows-open").click();
    await expect(page.getByTestId("page-runtime")).toBeVisible();
    await expect(page.getByTestId("sql-input")).toHaveValue(/FROM metrics WHERE service = 'recommendationservice'/);
  });

  test("incident picker swaps the scenario and reloads the session", async ({ page }) => {
    await bootAtStart(page);

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

    // Verdict hero repopulates from the new session's evidence once seeked.
    await page.getByTestId("tab-overview").click();
    await seekToEnd(page);

    // The case brief and runtime status reflect the newly loaded incident.
    await page.getByTestId("tab-case").click();
    await expect(page.getByTestId("case-panel")).toBeVisible();
    await page.getByTestId("tab-runtime").click();
    await switchRuntimeTab(page, "recovery");
    await expect(page.getByTestId("arch-status")).toContainText("eval-cpu-cart-007", {
      timeout: 20_000,
    });
  });
});
