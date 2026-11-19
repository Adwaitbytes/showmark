/**
 * QIEDEX funding, mainnet only. Run against a mainnet build:
 *   E2E_CHAIN=1990 pnpm --filter web exec playwright test -c e2e/sponsor/playwright.config.ts dex.spec.ts
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getAddress } from "viem";
import { chainState, installWallet, MAINNET, mockApi, mockChain, SPONSOR } from "./harness";

const ROUTER = getAddress("0x08cd2e72e156D8563B4351eb4065C262A9f553Ef");
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = 400_000_000n; // 400 QUSDC short
const IN = 2_610_000_000_000_000_000_000n; // about 2,610 QIE
const MAX_IN = 2_636_100_000_000_000_000_000n;

const quote = {
  chainId: 1990,
  tradeType: "exactOut",
  amountIn: IN.toString(),
  amountOut: OUT.toString(),
  maxAmountIn: MAX_IN.toString(),
  minAmountOut: OUT.toString(),
  slippageBps: 100,
  priceImpactPct: 9.12,
  totalCostPct: 9.42,
  pathSymbols: ["QIE", "QUSDC"],
  router: ROUTER.toLowerCase(),
  warnings: [{ code: "PRICE_IMPACT_HIGH", severity: "warning", message: "Price impact is above 5%." }],
  quotedAt: Math.floor(Date.now() / 1000),
};

test.skip(!MAINNET, "QIEDEX exists on QIE Mainnet only; run with E2E_CHAIN=1990");

test("buys the missing QUSDC through the QIEDEX router, with price impact called out", async ({ page }) => {
  const state = chainState({
    qusdcBalance: 100_000_000n,
    onSend: (tx, s) => {
      if (tx.to === ROUTER) s.qusdcBalance += OUT;
    },
  });
  await installWallet(page);
  await mockChain(page, state);
  await mockApi(page, { signedIn: true, dexQuote: quote });
  let swapUrl = "";
  await page.route("https://api.dex.qie.digital/swap?**", (route) => {
    swapUrl = route.request().url();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...quote, recipient: SPONSOR.toLowerCase(), tx: { to: ROUTER.toLowerCase(), data: "0xfb3bdb41", value: `0x${MAX_IN.toString(16)}`, chainId: 1990 } }),
    });
  });

  await page.goto("/sponsor/new");
  await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
  await page.getByLabel("Campaign name").fill("Pune builders nights");
  await page.getByLabel("Sponsor name").fill("Acme Labs");
  await page.getByRole("radio", { name: /QUSDC/ }).check({ force: true });
  await page.getByLabel("QUSDC per verified person").fill("2");
  await page.getByLabel("Deposit in QUSDC").fill("500");
  await page.getByRole("button", { name: "Review and fund" }).click();

  await expect(page.getByRole("heading", { name: "Buy the missing 400.00 QUSDC with QIE on QIEDEX" })).toBeVisible();
  await expect(page.getByText("This swap moves the price by 9.1 percent")).toBeVisible();
  await expect(page.getByText("9.12%")).toBeVisible();
  if (process.env.SCREENSHOTS) {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(process.cwd(), "e2e/sponsor/screenshots/new-qiedex--1440--light.png"), fullPage: true });
  }

  await page.getByRole("button", { name: "Swap QIE for 400.00 QUSDC" }).click();
  await expect(page.getByText("Bought 400.00 QUSDC")).toBeVisible();
  const swap = state.sent[0]!;
  expect(swap.to).toBe(ROUTER);
  expect(swap.value).toBe(MAX_IN);
  expect(new URL(swapUrl).searchParams.get("recipient")).toBe(SPONSOR);
  // With the QUSDC in hand, the approve step unlocks.
  await expect(page.getByRole("button", { name: "Approve 500.00 QUSDC" })).toBeEnabled();
});
