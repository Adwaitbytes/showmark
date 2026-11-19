import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Organizer console and door screen tests. Chain, API and wallet are mocked (see mocks.ts), so they run offline.
// The app runs on its own dev server with test contract addresses; see serve.sh for why it is a separate copy.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // Outside the repo: other workstreams clean apps/web/test-results while these tests run.
  outputDir: path.join(os.tmpdir(), "showmark-organizer-e2e"),
  use: {
    baseURL: process.env.ORGANIZER_E2E_URL ?? "http://localhost:3210",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "./serve.sh",
    url: "http://localhost:3210/organize",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
