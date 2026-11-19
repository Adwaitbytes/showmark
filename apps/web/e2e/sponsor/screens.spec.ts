/**
 * Visual QA: every sponsor screen and state at 390 x 844 and 1440 x 900, paper and night desk, plus the printed
 * report as a PDF. Run with SCREENSHOTS=1 (see playwright.config.ts). Output: e2e/sponsor/screenshots/.
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CAMPAIGN_DETAIL, CAMPAIGNS, EMPTY_DETAIL, EVENTS, onChainCampaign } from "./fixtures";
import { chainState, installWallet, mockApi, mockChain, type ApiMocks, type ChainState } from "./harness";

const here = path.join(process.cwd(), "e2e", "sponsor");
// JPEG at quality 80: the paper grain makes PNGs about 2 MB each, and these live in the repository.
const out = (name: string) => path.join(here, "screenshots", `${name}.jpg`);

const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;
const themes = ["light", "dark"] as const;
// Narrow a run while iterating: SCREENS=campaign-sponsor,report SCREENSHOTS=1 playwright test ...

interface Setup {
  api?: ApiMocks;
  chain?: Partial<ChainState>;
}

async function open(browser: Browser, vp: (typeof viewports)[number], theme: (typeof themes)[number], setup: Setup) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  await installWallet(page);
  await mockChain(page, chainState(setup.chain));
  await mockApi(page, setup.api);
  return page;
}

async function connect(page: Page, route: string) {
  await page.goto(route);
  await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
}

/** Detail pages have no connect button of their own: connect on /sponsor, then open the page. */
async function asSponsor(page: Page, route: string) {
  await connect(page, "/sponsor");
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  await page.goto(route);
}

async function fillQie(page: Page) {
  await page.getByLabel("Campaign name").fill("Pune builders nights");
  await page.getByLabel("Sponsor name").fill("Acme Labs");
  await page.getByLabel("Description").fill("Pays every verified attendee at Pune builder meetups this season.");
  await page.getByLabel("QIE per verified person").fill("10");
  await page.getByLabel("Deposit in QIE").fill("1000");
}

/** Hides the Next.js dev badge, drops focus and scrolls to the top so full-page captures show the page as loaded. */
async function settle(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
}

type Screen = { name: string; setup: Setup; run: (page: Page) => Promise<void> };

const detailChain = { campaign: onChainCampaign() };
const ended = (days: number) => BigInt(Math.floor(Date.now() / 1000) - days * 86_400);

const screens: Screen[] = [
  {
    name: "home-signed-out",
    setup: {},
    run: async (page) => {
      await page.goto("/sponsor");
      await expect(page.getByRole("button", { name: "Connect QIE Wallet" })).toBeVisible();
    },
  },
  {
    name: "home-sign-in",
    setup: {},
    run: async (page) => {
      await connect(page, "/sponsor");
      await expect(page.getByRole("button", { name: "Sign in with QIE Wallet" })).toBeVisible();
    },
  },
  {
    name: "home-list",
    setup: { api: { signedIn: true, campaigns: CAMPAIGNS } },
    run: async (page) => {
      await connect(page, "/sponsor");
      await expect(page.getByRole("link", { name: /Pune builders nights/ })).toBeVisible();
    },
  },
  {
    name: "home-empty",
    setup: { api: { signedIn: true, campaigns: [] } },
    run: async (page) => {
      await connect(page, "/sponsor");
      await expect(page.getByRole("heading", { name: "No campaigns yet" })).toBeVisible();
    },
  },
  {
    name: "home-error",
    setup: { api: { signedIn: true, failWith: 503 } },
    run: async (page) => {
      await connect(page, "/sponsor");
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    },
  },
  {
    name: "home-loading",
    setup: { api: { signedIn: true } },
    run: async (page) => {
      await page.route("**/api/campaigns?**", () => undefined);
      await connect(page, "/sponsor");
      await expect(page.getByText("Loading your campaigns")).toBeAttached();
    },
  },
  {
    name: "new-blank",
    setup: { api: { signedIn: true } },
    run: async (page) => {
      await connect(page, "/sponsor/new");
      await expect(page.getByRole("form", { name: "New campaign" })).toBeVisible();
    },
  },
  {
    name: "new-usd-pricing",
    setup: { api: { signedIn: true } },
    run: async (page) => {
      await connect(page, "/sponsor/new");
      await fillQie(page);
      await page.getByRole("radio", { name: /A US dollar amount/ }).check({ force: true });
      await page.getByLabel("US dollars per verified person").fill("1.50");
      await expect(page.getByText("1 QIE = $0.1595")).toBeVisible();
    },
  },
  {
    name: "new-stale-oracle",
    setup: { api: { signedIn: true }, chain: { oracleUpdatedAt: Math.floor(Date.now() / 1000) - 60 * 3600 } },
    run: async (page) => {
      await connect(page, "/sponsor/new");
      await page.getByRole("radio", { name: /A US dollar amount/ }).check({ force: true });
      await expect(page.getByText(/older than the vault's 48 hour limit/)).toBeVisible();
    },
  },
  {
    name: "new-errors",
    setup: { api: { signedIn: true } },
    run: async (page) => {
      await connect(page, "/sponsor/new");
      await page.getByRole("button", { name: "Review and fund" }).click();
      await expect(page.getByText(/need fixing before you fund/)).toBeVisible();
    },
  },
  {
    name: "new-funding-qusdc",
    setup: { api: { signedIn: true }, chain: { qusdcBalance: 1_000n * 10n ** 6n } },
    run: async (page) => {
      await connect(page, "/sponsor/new");
      await page.getByLabel("Campaign name").fill("Pune builders nights");
      await page.getByLabel("Sponsor name").fill("Acme Labs");
      await page.getByRole("radio", { name: /QUSDC/ }).check({ force: true });
      await page.getByLabel("QUSDC per verified person").fill("2");
      await page.getByLabel("Deposit in QUSDC").fill("500");
      await page.getByRole("button", { name: "Review and fund" }).click();
      await page.getByRole("button", { name: "Approve 500.00 QUSDC" }).click();
      await expect(page.getByText("Approved 500.00 QUSDC for the vault")).toBeVisible();
    },
  },
  {
    name: "new-created",
    setup: { api: { signedIn: true } },
    run: async (page) => {
      await connect(page, "/sponsor/new");
      await fillQie(page);
      await page.getByRole("button", { name: "Review and fund" }).click();
      await page.getByRole("button", { name: "Deposit 1,000 QIE" }).click();
      await expect(page.getByRole("heading", { name: /is in escrow/ })).toBeVisible();
    },
  },
  {
    name: "campaign-sponsor",
    setup: { api: { signedIn: true, campaign: CAMPAIGN_DETAIL, events: EVENTS }, chain: detailChain },
    run: async (page) => {
      await asSponsor(page, "/sponsor/7");
      await expect(page.getByRole("heading", { name: "Manage" })).toBeVisible();
    },
  },
  {
    name: "campaign-visitor",
    setup: { api: { campaign: CAMPAIGN_DETAIL }, chain: detailChain },
    run: async (page) => {
      await page.goto("/sponsor/7");
      await expect(page.getByText("Are you the sponsor?")).toBeVisible();
    },
  },
  {
    name: "campaign-empty",
    setup: { api: { signedIn: true, campaign: EMPTY_DETAIL, events: EVENTS }, chain: { campaign: onChainCampaign({ balance: 500_000_000n, settledCount: 0 }) } },
    run: async (page) => {
      await asSponsor(page, "/sponsor/7");
      await expect(page.getByRole("heading", { name: "No payouts yet" })).toBeVisible();
    },
  },
  {
    name: "campaign-refund-open",
    setup: {
      api: { signedIn: true, campaign: { ...CAMPAIGN_DETAIL, status: "refundable" }, events: EVENTS },
      chain: { campaign: onChainCampaign({ endsAt: ended(4) }) },
    },
    run: async (page) => {
      await asSponsor(page, "/sponsor/7");
      await expect(page.getByRole("button", { name: /^Refund 4/ })).toBeEnabled();
    },
  },
  {
    name: "campaign-not-found",
    setup: { api: {} },
    run: async (page) => {
      await page.goto("/sponsor/999");
      await expect(page.getByRole("heading", { name: "There is no campaign #999" })).toBeVisible();
    },
  },
  {
    name: "report",
    setup: { api: { campaign: CAMPAIGN_DETAIL }, chain: detailChain },
    run: async (page) => {
      await page.goto("/sponsor/7/report");
      await expect(page.getByRole("heading", { name: /Every payout/ })).toBeVisible();
    },
  },
];

test.describe.configure({ mode: "serial" });

for (const theme of themes) {
  for (const vp of viewports) {
    test(`sponsor screens ${vp.name} ${theme}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const only = process.env.SCREENS?.split(",");
      for (const screen of screens.filter((x) => !only || only.includes(x.name))) {
        const page = await open(browser, vp, theme, screen.setup);
        await screen.run(page);
        await settle(page);
        await page.screenshot({ path: out(`${screen.name}--${vp.name}--${theme}`), fullPage: true, type: "jpeg", quality: 80 });
        await page.context().close();
      }
    });
  }
}

test("printed report", async ({ browser }) => {
  const page = await open(browser, viewports[1], "dark", { api: { campaign: CAMPAIGN_DETAIL }, chain: detailChain });
  await page.goto("/sponsor/7/report");
  await expect(page.getByRole("heading", { name: /Every payout/ })).toBeVisible();
  await settle(page);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: out("report--print"), fullPage: true, type: "jpeg", quality: 80 });
  await page.pdf({ path: path.join(here, "screenshots", "report.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  await page.context().close();
});
