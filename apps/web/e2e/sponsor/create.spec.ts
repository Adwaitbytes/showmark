import { expect, test, type Page } from "@playwright/test";
import { decodeFunctionData, getAddress, zeroAddress } from "viem";
import { erc20Abi, vaultAbi } from "../../src/lib/chain/abi";
import { ADDR, chainState, installWallet, mockApi, mockChain, NEW_CAMPAIGN_ID, SPONSOR, type ChainState } from "./harness";

async function signIn(page: Page) {
  await page.goto("/sponsor/new");
  await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
  await page.getByRole("button", { name: "Sign in with QIE Wallet" }).click();
  await expect(page.getByRole("form", { name: "New campaign" })).toBeVisible();
}

async function fillBasics(page: Page) {
  await page.getByLabel("Campaign name").fill("Pune builders nights");
  await page.getByLabel("Sponsor name").fill("Acme Labs");
}

function createArgs(state: ChainState) {
  const tx = state.sent.find((t) => t.to === ADDR.vault);
  expect(tx, "a createCampaign transaction was sent to the vault").toBeDefined();
  const call = decodeFunctionData({ abi: vaultAbi, data: tx!.data });
  expect(call.functionName).toBe("createCampaign");
  if (call.functionName !== "createCampaign") throw new Error("unreachable");
  return { tx: tx!, params: call.args[0], deposit: call.args[1] };
}

test.describe("create a campaign", () => {
  test("native QIE: shows the vault's math, then sends one createCampaign with the deposit as value", async ({ page }) => {
    const state = chainState();
    await installWallet(page);
    await mockChain(page, state);
    await mockApi(page);
    await signIn(page);

    await fillBasics(page);
    await page.getByLabel("QIE per verified person").fill("10");
    await page.getByLabel("Deposit in QIE").fill("1000");

    // 1000 / 10 = 100 people; fee 2.5% then 50/50: 4.875 each, 0.25 fee.
    const receipt = page.getByRole("complementary", { name: "Campaign summary" });
    await expect(receipt.getByText("100", { exact: true })).toBeVisible();
    await expect(receipt.getByText("4.875 QIE").first()).toBeVisible();
    await expect(receipt.getByText("0.25 QIE")).toBeVisible();

    await page.getByRole("button", { name: "Review and fund" }).click();
    await page.getByRole("button", { name: "Deposit 1,000 QIE" }).click();

    await expect(page.getByRole("heading", { name: `Campaign #${NEW_CAMPAIGN_ID} is in escrow` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Approve events" })).toHaveAttribute("href", `/sponsor/${NEW_CAMPAIGN_ID}`);

    const { tx, params, deposit } = createArgs(state);
    expect(tx.from).toBe(SPONSOR);
    expect(tx.value).toBe(1_000n * 10n ** 18n);
    expect(deposit).toBe(1_000n * 10n ** 18n);
    expect(params).toMatchObject({
      token: zeroAddress,
      pricing: 0,
      amountPerPresence: 10n * 10n ** 18n,
      attendeeShareBps: 5_000,
      minProofMode: 1,
      requireQieId: false,
      openToBonded: false,
      maxPerEvent: 0,
      maxTotal: 0,
    });
    expect(JSON.parse(params.metadata)).toEqual({ v: 1, name: "Pune builders nights", sponsor: "Acme Labs", description: "" });
    expect(state.sent).toHaveLength(1);
  });

  test("QUSDC: approves exactly the deposit, then creates the campaign with no value", async ({ page }) => {
    const state = chainState();
    await installWallet(page);
    await mockChain(page, state);
    await mockApi(page);
    await signIn(page);

    await fillBasics(page);
    await page.getByRole("radio", { name: /QUSDC/ }).check({ force: true });
    await page.getByLabel("QUSDC per verified person").fill("2");
    await page.getByRole("radio", { name: /Door scans you/ }).check({ force: true });
    await page.getByLabel("Only pay attendees with a QIE ID").check();
    await page.getByLabel("Deposit in QUSDC").fill("500");
    await expect(page.getByRole("complementary", { name: "Campaign summary" }).getByText("250", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Review and fund" }).click();
    await expect(page.getByRole("button", { name: "Deposit 500.00 QUSDC" })).toBeDisabled();
    await page.getByRole("button", { name: "Approve 500.00 QUSDC" }).click();
    await expect(page.getByText("Approved 500.00 QUSDC for the vault")).toBeVisible();
    await page.getByRole("button", { name: "Deposit 500.00 QUSDC" }).click();
    await expect(page.getByRole("heading", { name: `Campaign #${NEW_CAMPAIGN_ID} is in escrow` })).toBeVisible();

    const approve = state.sent[0]!;
    expect(approve.to).toBe(ADDR.qusdc);
    const approveCall = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    expect(approveCall.functionName).toBe("approve");
    expect(approveCall.args).toEqual([getAddress(ADDR.vault), 500_000_000n]);

    const { tx, params, deposit } = createArgs(state);
    expect(tx.value).toBe(0n);
    expect(deposit).toBe(500_000_000n);
    expect(params).toMatchObject({ token: ADDR.qusdc, amountPerPresence: 2_000_000n, minProofMode: 2, requireQieId: true });
  });

  test("USD pricing: shows the live oracle price and its age, and stores 6 decimal USD", async ({ page }) => {
    const state = chainState();
    await installWallet(page);
    await mockChain(page, state);
    await mockApi(page);
    await signIn(page);

    await fillBasics(page);
    await page.getByRole("radio", { name: /A US dollar amount/ }).check({ force: true });
    await expect(page.getByText("1 QIE = $0.1595")).toBeVisible();
    await expect(page.getByText(/updated 3 hours ago/)).toBeVisible();
    await expect(page.getByText(/A stale price delays a payout; it never pays the wrong amount/)).toBeVisible();
    await page.getByLabel("US dollars per verified person").fill("1.50");
    await page.getByLabel("Deposit in QIE").fill("940.5");
    await page.getByRole("button", { name: "Review and fund" }).click();
    await page.getByRole("button", { name: "Deposit 940.5 QIE" }).click();
    await expect(page.getByRole("heading", { name: `Campaign #${NEW_CAMPAIGN_ID} is in escrow` })).toBeVisible();

    const { params, tx } = createArgs(state);
    expect(params).toMatchObject({ token: zeroAddress, pricing: 1, amountPerPresence: 1_500_000n });
    expect(tx.value).toBe(9_405n * 10n ** 17n);
  });

  test("blocks funding and points at every field that needs fixing", async ({ page }) => {
    const state = chainState();
    await installWallet(page);
    await mockChain(page, state);
    await mockApi(page);
    await signIn(page);

    await page.getByRole("button", { name: "Review and fund" }).click();
    await expect(page.getByText(/things need fixing before you fund/)).toBeVisible();
    await expect(page.getByText("Give the campaign a name people will recognise.")).toBeVisible();
    await expect(page.getByText(/Enter an amount like 2.50/)).toBeVisible();
    await expect(page.getByLabel("Campaign name")).toBeFocused();
    await expect(page.getByRole("heading", { name: "Fund it" })).toHaveCount(0);
    expect(state.sent).toHaveLength(0);
  });

  test("a wallet without enough QIE is told so before anything is sent", async ({ page }) => {
    const state = chainState({ nativeBalance: 10n ** 18n });
    await installWallet(page);
    await mockChain(page, state);
    await mockApi(page);
    await signIn(page);

    await fillBasics(page);
    await page.getByLabel("QIE per verified person").fill("10");
    await page.getByLabel("Deposit in QIE").fill("1000");
    await page.getByRole("button", { name: "Review and fund" }).click();
    await expect(page.getByText("This wallet holds 1 QIE")).toBeVisible();
    await expect(page.getByRole("button", { name: "Deposit 1,000 QIE" })).toBeDisabled();
    expect(state.sent).toHaveLength(0);
  });
});
