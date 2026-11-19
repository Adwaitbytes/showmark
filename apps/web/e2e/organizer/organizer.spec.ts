import { expect, test } from "@playwright/test";
import { decodeFunctionData, getAddress, zeroAddress } from "viem";
import { vaultAbi } from "../../src/lib/chain/abi";
import { createState, installMocks, ORGANIZER, VAULT } from "./mocks";

// Console journeys found broken in the live run: withdrawing payouts, the door's connect then authorize step, and a
// stalled event API on the door.

test("an organizer withdraws payouts from their own wallet, not through the relayer", async ({ page }) => {
  const state = await installMocks(page, createState({ claimableWei: 3n * 10n ** 17n }));
  const relayed: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/relay/withdraw")) relayed.push(r.url());
  });
  await page.goto("/organize");
  await expect(page.getByText("Payouts waiting for you")).toBeVisible();

  await page.getByRole("button", { name: "Withdraw QIE to your wallet" }).click();
  await expect(page.getByText(/gas fee of about 0\.000225 QIE/)).toBeVisible();
  await page.getByRole("button", { name: /Confirm withdrawal of 0\.3/ }).click();
  await expect(page.getByText("Withdrawn to your wallet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /View the transaction on the explorer/ })).toBeVisible();

  expect(relayed).toEqual([]);
  expect(state.sent).toHaveLength(1);
  expect(getAddress(state.sent[0].to)).toBe(VAULT);
  const call = decodeFunctionData({ abi: vaultAbi, data: state.sent[0].data });
  expect(call.functionName).toBe("withdraw");
  expect(call.args).toEqual([zeroAddress, ORGANIZER]);
});

test("connecting the wallet on the door does not authorize the device under the same tap", async ({ page }) => {
  const state = await installMocks(page, createState(), { rememberWallet: false });
  await page.goto("/door/1");
  const connectButton = page.getByRole("button", { name: "Connect the organizer’s QIE Wallet" });
  await expect(connectButton).toBeVisible();
  const box = await connectButton.boundingBox();
  if (!box) throw new Error("no connect button");
  await connectButton.click();

  // Tapping the same spot again straight away hits a disabled Authorize button.
  const authorize = page.getByTestId("authorize-door");
  await expect(authorize).toBeVisible();
  await expect(authorize).toBeDisabled();
  await expect(page.getByText("Wallet connected. Check the details above, then authorize.")).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(state.sent).toHaveLength(0);

  // A deliberate tap a moment later authorizes it.
  await expect(authorize).toBeEnabled({ timeout: 5_000 });
  await authorize.click();
  await expect(page.getByTestId("door-qr")).not.toHaveAttribute("data-issued-at", "", { timeout: 30_000 });
  expect(state.sent).toHaveLength(1);
});

test("a stalled event API shows a placeholder name, never a bare event number", async ({ page }) => {
  await installMocks(page, createState({ authorizeAll: true, eventApiStalls: true }));
  await page.goto("/door/1");
  await expect(page.getByTestId("door-qr")).not.toHaveAttribute("data-issued-at", "");
  const heading = page.getByTestId("door-event-name");
  await expect(heading).toHaveAttribute("aria-busy", "true");
  // The number is there for screen readers only; sighted people see a placeholder bar.
  await expect(heading.locator(".sr-only")).toHaveText("Event 1");
  await expect(page.getByText("Event 1", { exact: true })).toHaveCount(1);
  await expect(heading.locator('[aria-hidden="true"]')).toBeVisible();
  await expect(page.getByTestId("door-count")).toHaveText("41");
});
