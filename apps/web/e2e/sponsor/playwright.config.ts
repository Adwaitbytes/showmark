import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, ENV, PORT } from "./harness";

// Sponsor console end-to-end tests. Wallet, chain RPC and /api are mocked in the browser (see harness.ts), so these
// run without contracts or a database:
//
//   pnpm --filter web exec playwright test -c e2e/sponsor/playwright.config.ts
//
// SCREENSHOTS=1 also runs screens.spec.ts, which writes every screen and state to e2e/sponsor/screenshots/.
export default defineConfig({
  testDir: ".",
  testMatch:
    process.env.E2E_CHAIN === "1990"
      ? ["dex.spec.ts"]
      : process.env.SCREENSHOTS
        ? ["create.spec.ts", "campaign.spec.ts", "safe.spec.ts", "screens.spec.ts"]
        : ["create.spec.ts", "campaign.spec.ts", "safe.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    cwd: "../..",
    url: `${BASE_URL}/sponsor`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { ...ENV },
  },
});
