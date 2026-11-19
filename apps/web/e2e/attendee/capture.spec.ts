import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { doorPath, ERRORS, mockApi, seedPass, type MockOptions } from "./fixtures";

/**
 * Visual QA capture for every attendee screen and state, at 390 x 844 and 1440 x 900, in paper and
 * night desk. Not a test: it writes screenshots for a person to look at.
 *
 *   pnpm --filter web exec playwright test -c e2e/attendee/playwright.config.ts --project=capture
 *   CAPTURE=checkin pnpm --filter web exec playwright test -c e2e/attendee/playwright.config.ts --project=capture
 */

const outDir = path.join(__dirname, "screenshots");
const only = process.env.CAPTURE;

const viewports = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
] as const;
const themes = ["light", "dark"] as const;

interface Shot {
  name: string;
  url: () => Promise<string>;
  mock?: MockOptions;
  pass?: boolean;
  locale?: "hi";
  setup?: (page: Page, context: BrowserContext) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const heading = (text: string | RegExp) => async (page: Page) => {
  await page.getByRole("heading", { level: 1, name: text }).waitFor();
};

const shots: Shot[] = [
  { name: "checkin--sending", url: () => doorPath(), mock: { checkIn: ["hang"] }, ready: heading("Checking you in") },
  { name: "checkin--confirming", url: () => doorPath(), mock: { tx: ["pending"] }, ready: heading("Recording your stamp on QIE") },
  { name: "checkin--stamped", url: () => doorPath(), ready: heading("You are checked in") },
  { name: "checkin--stamped-hi", url: () => doorPath(), locale: "hi", ready: heading("आपका चेक इन हो गया") },
  { name: "checkin--already", url: () => doorPath(), mock: { checkIn: [ERRORS.already] }, ready: heading("You were already checked in") },
  { name: "checkin--stale", url: () => doorPath(), mock: { checkIn: [ERRORS.stale] }, ready: heading(/expired/) },
  { name: "checkin--capacity", url: () => doorPath(), mock: { checkIn: [ERRORS.capacity] }, ready: heading(/full/) },
  {
    name: "checkin--window",
    url: () => doorPath(),
    mock: {
      checkIn: [ERRORS.window],
      eventOverrides: { startsAt: new Date(Date.now() + 5 * 3_600_000).toISOString(), endsAt: new Date(Date.now() + 8 * 3_600_000).toISOString() },
    },
    ready: heading(/closed/),
  },
  { name: "checkin--relay-down", url: () => doorPath(), mock: { checkIn: [ERRORS.down] }, ready: heading("Your check-in is saved on this phone") },
  {
    name: "checkin--offline",
    url: () => doorPath(),
    setup: async (page, context) => {
      await page.route("**/api/relay/check-in", async (route) => {
        await context.setOffline(true);
        await route.abort("internetdisconnected");
      });
    },
    ready: async (page) => {
      await page.getByText("Your phone is offline.").waitFor();
    },
  },
  { name: "checkin--event-failed", url: () => doorPath(), mock: { event: "fail" }, ready: heading("You are checked in") },
  { name: "checkin--invalid", url: async () => "/c/not-a-door-code", ready: heading(/not a Showmark door code/) },
];

async function capture(browser: Browser, shot: Shot) {
  for (const theme of themes) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
        deviceScaleFactor: 1,
        colorScheme: theme,
        reducedMotion: "reduce",
        baseURL: test.info().project.use.baseURL,
      });
      const page = await context.newPage();
      await mockApi(page, shot.mock);
      if (shot.pass) await seedPass(page);
      if (shot.locale) await page.addInitScript(() => window.localStorage.setItem("showmark.lang", "hi"));
      await shot.setup?.(page, context);
      await page.goto(await shot.url());
      await shot.ready(page);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, `${shot.name}--${viewport.name}--${theme}.png`), fullPage: true });
      await context.close();
    }
  }
}

test.beforeAll(async () => {
  await mkdir(outDir, { recursive: true });
});

for (const shot of shots) {
  test(shot.name, async ({ browser }) => {
    test.skip(Boolean(only) && !shot.name.startsWith(only ?? ""), "not selected");
    await capture(browser, shot);
  });
}

