import { expect, type Page } from "@playwright/test";

export type RuntimeTab = "pipeline" | "event-time" | "queries" | "scoring" | "recovery";

// The Runtime drawer shows one sub-tab at a time; open the one a spec needs
// and wait for its pane to mount.
export async function switchRuntimeTab(page: Page, id: RuntimeTab) {
  await page.getByTestId(`runtime-tab-${id}`).click();
  await expect(page.getByTestId(`runtime-pane-${id}`)).toBeVisible({ timeout: 10_000 });
}
