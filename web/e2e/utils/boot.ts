import { expect, type Page } from "@playwright/test";

export const LOAD_TIMEOUT = 40_000;

// Boot at t+0: nothing revealed. Waits for the session, then dismisses the
// first-visit choice card (every Playwright context starts with an empty
// localStorage, so the card always shows).
export async function bootAtStart(page: Page, opts: { keepFirstVisit?: boolean } = {}) {
  await page.goto("/");
  await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId("connection")).toContainText("connected", { timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId("replay-state")).toContainText("ready", { timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId("scrubber-time")).toHaveText("0.0 s in", { timeout: LOAD_TIMEOUT });
  if (opts.keepFirstVisit) return;
  await dismissFirstVisit(page);
}

export async function dismissFirstVisit(page: Page) {
  const investigate = page.getByTestId("first-visit-investigate");
  await expect(investigate).toBeVisible({ timeout: LOAD_TIMEOUT });
  await investigate.click();
  await expect(page.getByTestId("first-visit")).toHaveCount(0);
}

// Seek the session to the incident end through the API, then wait for the
// projections to land: the populated verdict the old verdict-first boot gave.
export async function seekToEnd(page: Page) {
  const shell = page.locator(".shell.embed");
  await expect(shell).toHaveAttribute("data-session", /.+/, { timeout: LOAD_TIMEOUT });
  await expect(shell).toHaveAttribute("data-end-ns", /.+/, { timeout: LOAD_TIMEOUT });
  const sessionId = await shell.getAttribute("data-session");
  const endNs = await shell.getAttribute("data-end-ns");
  expect(sessionId && endNs, "session id and incident end on the shell").toBeTruthy();
  const r = await page.request.post(`/api/v1/sessions/${sessionId}/seek`, {
    data: { event_time_ns: Number(endNs) },
  });
  expect(r.ok(), `seek returned ${r.status()}`).toBeTruthy();
  await expect(page.getByTestId("scrubber-time")).not.toHaveText("0.0 s in", { timeout: 15_000 });
  await expect(page.getByTestId("verdict-hero")).toContainText("Top root-cause candidate", {
    timeout: 20_000,
  });
}

export async function bootAtEnd(page: Page) {
  await bootAtStart(page);
  await seekToEnd(page);
}

// Click the scrubber at a fraction of its width.
export async function seekFraction(page: Page, frac: number) {
  const track = page.getByTestId("timeline");
  const box = await track.boundingBox();
  expect(box, "timeline track has a bounding box").not.toBeNull();
  if (!box) return;
  const x = box.x + Math.max(2, Math.min(box.width - 2, box.width * frac));
  await page.mouse.click(x, box.y + box.height / 2);
  // let the seek round-trip and the projections repaint
  await page.waitForTimeout(700);
}
