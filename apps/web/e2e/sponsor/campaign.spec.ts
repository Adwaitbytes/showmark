import { expect, test, type Page } from "@playwright/test";
import { decodeFunctionData, getAddress } from "viem";
import { vaultAbi } from "../../src/lib/chain/abi";
import { CAMPAIGN_DETAIL, CAMPAIGN_SUMMARY, EVENTS, onChainCampaign } from "./fixtures";
import { ADDR, chainState, installWallet, mockApi, mockChain, type ChainState } from "./harness";

async function openAsSponsor(page: Page, state: ChainState, detail = CAMPAIGN_DETAIL) {
  await installWallet(page);
  await mockChain(page, state);
  await mockApi(page, { signedIn: true, campaign: detail, campaigns: [CAMPAIGN_SUMMARY], events: EVENTS });
  // Connecting once remembers the wallet; the campaign page then restores it silently.
  await page.goto("/sponsor");
  await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
  await expect(page.getByRole("heading", { name: "Your campaigns" })).toBeVisible();
  await page.goto(`/sponsor/${detail.id}`);
  await expect(page.getByRole("heading", { level: 1, name: detail.name })).toBeVisible();
}

function vaultCall(state: ChainState) {
  const tx = state.sent.find((t) => t.to === ADDR.vault);
  expect(tx).toBeDefined();
  return decodeFunctionData({ abi: vaultAbi, data: tx!.data });
}

test.describe("campaign console", () => {
  test("shows verified reach and approves a new event found by search", async ({ page }) => {
    const state = chainState({ campaign: onChainCampaign() });
    await openAsSponsor(page, state);

    await expect(page.getByText("Verified people paid").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Approved events" }).getByRole("link", { name: "Builders night 14" })).toBeVisible();
    await expect(page.getByText(/31 check-ins within 60 seconds/)).toBeVisible();

    await page.getByLabel("Find events to fund").fill("bengaluru");
    const results = page.getByRole("list", { name: "Events you can approve" });
    await expect(results.getByRole("link", { name: "QIE builders meetup" })).toBeVisible();
    await results.getByRole("button", { name: "Approve" }).click();
    await expect(results.getByText("Approved")).toBeVisible();

    const call = vaultCall(state);
    expect(call.functionName).toBe("approveEvents");
    expect(call.args).toEqual([7n, [21n]]);
  });

  const endedAgo = (days: number) => BigInt(Math.floor(Date.now() / 1000) - days * 86_400);

  test("states the exact date the refund opens while it is still closed", async ({ page }) => {
    const waiting = chainState({ campaign: onChainCampaign({ endsAt: endedAgo(1) }) });
    await openAsSponsor(page, waiting, { ...CAMPAIGN_DETAIL, status: "ended" });
    const opens = new Date((Number(endedAgo(1)) + 3 * 86_400 + 1) * 1000);
    const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(opens);
    await expect(page.getByRole("button", { name: `Refund opens ${day}` })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Top up" })).toHaveCount(0);
  });

  test("refunds the unspent budget once the grace period has passed", async ({ page }) => {
    const open = chainState({ campaign: onChainCampaign({ endsAt: endedAgo(4) }) });
    await openAsSponsor(page, open, { ...CAMPAIGN_DETAIL, status: "refundable" });
    await page.getByRole("button", { name: /^Refund 4\d\d\.\d\d QUSDC$/ }).click();
    await expect(page.getByText("Refunded", { exact: true })).toBeVisible();
    const call = vaultCall(open);
    expect(call.functionName).toBe("refund");
    expect(call.args).toEqual([7n]);
  });

  test("a visitor sees the public view without sponsor controls", async ({ page }) => {
    const state = chainState({ campaign: onChainCampaign() });
    await installWallet(page, getAddress("0x00000000000000000000000000000000000b0b00"));
    await mockChain(page, state);
    await mockApi(page, { campaign: CAMPAIGN_DETAIL, events: EVENTS });
    await page.goto("/sponsor/7");
    await expect(page.getByRole("heading", { level: 1, name: CAMPAIGN_DETAIL.name })).toBeVisible();
    await expect(page.getByText("Are you the sponsor?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(page.getByLabel("Find events to fund")).toHaveCount(0);
  });
});
