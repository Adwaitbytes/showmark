import { defineConfig, devices } from "@playwright/test";

/**
 * Attendee app e2e tests with the API mocked through page.route. The real end-to-end run against
 * a chain is separate. Uses a running dev server when there is one, otherwise starts it.
 *
 *   pnpm --filter web exec playwright test -c e2e/attendee/playwright.config.ts              # tests
 *   pnpm --filter web exec playwright test -c e2e/attendee/playwright.config.ts --project=capture   # screenshots
 */
const port = Number(process.env.ATTENDEE_PORT ?? 3100);
// A stand-in registry address so the app's live chain reads (walletOf) run against the mocked RPC.
// The dev server must be started with the same value: NEXT_PUBLIC_REGISTRY_ADDRESS=... pnpm next dev.
process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ??= "0x5FbDB2315678afecb367f032d93F642f64180aa3";
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
    : {
        command: `pnpm next dev --port ${port}`,
        url: `${baseURL}/`,
        reuseExistingServer: true,
        cwd: "../..",
        timeout: 120_000,
        env: { NEXT_PUBLIC_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS },
      },
  projects: [
    {
      name: "phone",
      testMatch: /checkin\.spec\.ts|scan\.spec\.ts|pass\.spec\.ts|link\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        browserName: "chromium",
        launchOptions: { args: ["--use-fake-device-for-media-stream"] },
      },
    },
    {
      name: "capture",
      testMatch: /capture\.spec\.ts/,
      // A fake camera device (Chromium's test pattern); access still needs grantPermissions.
      use: { browserName: "chromium", channel: "chromium", reducedMotion: "reduce", launchOptions: { args: ["--use-fake-device-for-media-stream"] } },
    },
  ],
});
