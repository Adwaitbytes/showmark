import { defineConfig, devices } from "@playwright/test";

/**
 * Attendee app e2e tests with the API mocked through page.route. The real end-to-end run against
 * a chain is separate. Uses a running dev server when there is one, otherwise starts it.
 *
 *   pnpm --filter web exec playwright test -c e2e/attendee/playwright.config.ts              # tests
 *   pnpm --filter web exec playwright test -c e2e/attendee/playwright.config.ts --project=capture   # screenshots
 */
const port = Number(process.env.ATTENDEE_PORT ?? 3100);
const baseURL = process.env.ATTENDEE_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  webServer: process.env.ATTENDEE_BASE_URL
    ? undefined
    : { command: `pnpm next dev --port ${port}`, url: `${baseURL}/`, reuseExistingServer: true, cwd: "../..", timeout: 120_000 },
  projects: [
    {
      name: "phone",
      testMatch: /checkin\.spec\.ts|scan\.spec\.ts|pass\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, browserName: "chromium" },
    },
    {
      name: "capture",
      testMatch: /capture\.spec\.ts/,
      use: { browserName: "chromium", reducedMotion: "reduce" },
    },
  ],
});
