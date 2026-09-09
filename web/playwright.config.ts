import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /layout-overlap/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Label-overlap + one-screen sweep across viewports. Run with
      // `npx playwright test --project=layout` (or `make layout-check`).
      name: "layout",
      testMatch: /layout-overlap/,
      timeout: 240_000,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
