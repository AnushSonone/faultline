import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// TA-051: time to first visual, interaction latency, WS message rate,
// JS heap after replay. Wall-clock in a real browser; recorded to
// benchmarks/frontend-perf.json for RESULTS.md.
test("frontend performance measurements", async ({ page }) => {
  const metrics: Record<string, number> = {};

  // Attach before navigation so the initial socket is captured.
  let frames = 0;
  let counting = false;
  page.on("websocket", (ws) =>
    ws.on("framereceived", () => {
      if (counting) frames++;
    }),
  );

  const t0 = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: 30_000 });
  metrics.time_to_first_visual_ms = Date.now() - t0;

  await expect(page.getByTestId("connection")).toContainText("ws live", {
    timeout: 30_000,
  });
  metrics.ws_live_ms = Date.now() - t0;

  // WS payload rate during 3s of playback.
  counting = true;
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Pause" }).click();
  counting = false;
  metrics.ws_frames_per_sec = Math.round((frames / 3) * 10) / 10;

  // Tab switch interaction latency (click -> page visible), averaged.
  const tabs = ["root-causes", "signals", "runtime", "overview"] as const;
  let tabTotal = 0;
  for (const tab of tabs) {
    const t = Date.now();
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByTestId(`page-${tab}`)).toBeVisible();
    tabTotal += Date.now() - t;
  }
  metrics.tab_switch_avg_ms = Math.round(tabTotal / tabs.length);

  // Scrubber seek latency: click -> cursor time chip updates.
  const before = await page.getByTestId("scrubber-time").innerText();
  const box = await page
    .getByTestId("replay-scrubber")
    .locator(".scrubber")
    .boundingBox();
  const t1 = Date.now();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
    await expect(page.getByTestId("scrubber-time")).not.toHaveText(before, {
      timeout: 5_000,
    });
  }
  metrics.seek_latency_ms = Date.now() - t1;

  // JS heap after a longer replay (chromium-only API).
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Pause" }).click();
  const heap = await page.evaluate(
    () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      ?.usedJSHeapSize ?? 0,
  );
  metrics.js_heap_after_replay_mb = Math.round((heap / 1024 / 1024) * 10) / 10;

  // cwd is web/ when run via playwright.perf.config.ts.
  const out = path.resolve(process.cwd(), "../benchmarks/frontend-perf.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));

  expect(metrics.time_to_first_visual_ms).toBeLessThan(15_000);
  expect(metrics.ws_frames_per_sec).toBeGreaterThan(0);
});
