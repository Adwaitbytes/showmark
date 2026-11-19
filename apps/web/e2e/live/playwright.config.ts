import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Live wallet journeys: production URL, QIE testnet, real transactions from the throwaway key in .env.local.
// Not part of CI. Run deliberately:
//
//   pnpm --filter web exec playwright test -c e2e/live/playwright.config.ts
export default defineConfig({
  testDir: ".",
  testMatch: /journeys\.spec\.ts$/,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), "showmark-live-e2e"),
  use: { browserName: "chromium", trace: "retain-on-failure", actionTimeout: 30_000 },
});
