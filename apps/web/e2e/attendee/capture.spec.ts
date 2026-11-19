import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { doorPath, ERRORS, installFakeWallet, mockApi, seedPass, TEST_PASS, type MockOptions } from "./fixtures";

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
  /** A fake camera (Chromium's test pattern) instead of none. */
  camera?: boolean;
  /** A fake QIE Wallet announced over EIP-6963. */
  wallet?: boolean;
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

  { name: "pass--no-pass", url: async () => "/pass", ready: heading("Your passport") },
  { name: "pass--empty", url: async () => "/pass", pass: true, mock: { passport: "empty" }, ready: async (page) => void (await page.getByText("No stamps yet").waitFor()) },
  { name: "pass--full", url: async () => "/pass", pass: true, mock: { passport: "full" }, ready: async (page) => void (await page.getByText("Payouts on the way").waitFor()) },
  { name: "pass--full-hi", url: async () => "/pass", pass: true, locale: "hi", mock: { passport: "full" }, ready: async (page) => void (await page.getByText("रास्ते में भुगतान").waitFor()) },
  { name: "pass--linked", url: async () => "/pass", pass: true, mock: { passport: "linked" }, ready: async (page) => void (await page.getByText("asha.qie").first().waitFor()) },
  { name: "pass--failed", url: async () => "/pass", pass: true, mock: { passport: "fail" }, ready: heading("Your passport") },
  {
    name: "pass--outbox",
    url: async () => "/pass",
    pass: true,
    mock: { passport: "full" },
    setup: async (page) => {
      await page.addInitScript((attendee) => {
        const request = { eventId: "14", attendee, mode: 1, doorTime: "1764245000", ticket: `0x${"33".repeat(20)}`, attendeeSig: `0x${"11".repeat(65)}`, doorSig: `0x${"22".repeat(65)}`, ticketSig: `0x${"44".repeat(65)}` };
        window.localStorage.setItem("showmark.outbox.v1", JSON.stringify([{ request, eventName: "Solidity study circle", savedAt: Date.now() }]));
      }, TEST_PASS);
    },
    ready: async (page) => void (await page.getByText("A check-in is waiting to be sent").waitFor()),
  },
  {
    name: "pass--code-fullscreen",
    url: async () => "/pass",
    pass: true,
    mock: { passport: "full" },
    ready: async (page) => {
      await page.getByRole("button", { name: "Show full screen" }).click();
      await page.getByRole("button", { name: "Close" }).waitFor();
    },
  },

  {
    name: "scan--denied",
    url: async () => "/scan",
    // Headless Chromium leaves the permission prompt open instead of denying, so deny it the way a browser reports it.
    setup: async (page) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      });
    },
    ready: async (page) => void (await page.getByText("Showmark is not allowed to use your camera.").waitFor()),
  },
  {
    name: "scan--live",
    url: async () => "/scan",
    camera: true,
    ready: async (page) => {
      await page.locator("video").evaluate((v: HTMLVideoElement) => new Promise((r) => (v.readyState >= 2 ? r(null) : v.addEventListener("playing", () => r(null)))));
    },
  },

  { name: "link--no-wallet", url: async () => "/pass/link", pass: true, mock: { passport: "full" }, ready: async (page) => {
    await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
    await page.getByText("No wallet was found in this browser.").waitFor();
  } },
  { name: "link--connected", url: async () => "/pass/link", pass: true, wallet: true, mock: { passport: "full" }, ready: async (page) => {
    await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
    await page.getByText("Connected wallet").waitFor();
    await page.getByRole("button", { name: "Link this wallet" }).and(page.locator(":not([disabled])")).waitFor();
  } },
  { name: "link--linked", url: async () => "/pass/link", pass: true, wallet: true, mock: { passport: "full", tx: ["success"] }, ready: async (page) => {
    await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
    await page.getByRole("button", { name: "Link this wallet" }).and(page.locator(":not([disabled])")).click();
    await page.getByText("QIE Wallet is linked").waitFor();
  } },
  { name: "link--no-pass", url: async () => "/pass/link", ready: async (page) => void (await page.getByText("There is no pass on this phone yet.").waitFor()) },

  { name: "withdraw--ready", url: async () => "/pass/withdraw", pass: true, mock: { passport: "linked" }, ready: async (page) => void (await page.getByRole("button", { name: "Withdraw everything" }).waitFor()) },
  { name: "withdraw--done", url: async () => "/pass/withdraw", pass: true, mock: { passport: "linked", tx: ["success"] }, ready: async (page) => {
    await page.getByRole("button", { name: "Withdraw everything" }).click();
    await page.getByRole("link", { name: "Back to passport" }).last().waitFor();
  } },
  { name: "withdraw--needs-link", url: async () => "/pass/withdraw", pass: true, mock: { passport: "full" }, ready: async (page) => void (await page.getByText("Link QIE Wallet before you withdraw.").waitFor()) },
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
      if (shot.camera) await context.grantPermissions(["camera"]);
      const page = await context.newPage();
      await mockApi(page, shot.mock);
      if (shot.wallet) await installFakeWallet(page);
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

