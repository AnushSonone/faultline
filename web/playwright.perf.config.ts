import { defineConfig, devices } from "@playwright/test";

// TA-051 frontend performance suite. Run explicitly:
//   npx playwright test -c playwright.perf.config.ts
// Requires the demo stack (make demo) like the e2e suite.
export default defineConfig({
  testDir: "./perf",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
  },
});
