import { expect, test } from "@playwright/test";
import { installFakeWallet, mockApi, seedPass } from "./fixtures";

// Right after linking, the index lags the chain by 15 to 45 seconds. Withdraw must not say
// "link a wallet first" in that window (live journey finding B2).

test.describe("wallet link state", () => {
  test("withdraw reads the link from the chain before the index has it", async ({ page }) => {
    await mockApi(page, { passport: "full", chainWallet: "linked" });
    await seedPass(page);
    await page.goto("/pass/withdraw");
    await expect(page.getByRole("button", { name: "Withdraw everything" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Link QIE Wallet before you withdraw.")).toHaveCount(0);
  });

  test("withdraw is ready straight after linking, even when the chain cannot be read", async ({ page }) => {
    await mockApi(page, { passport: "full", chainWallet: "down", tx: ["success"] });
    await seedPass(page);
    await installFakeWallet(page);
    await page.goto("/pass/link");
    await page.getByRole("button", { name: "Connect QIE Wallet" }).click();
    await page.getByRole("button", { name: "Link this wallet" }).click();
    await expect(page.getByText("QIE Wallet is linked")).toBeVisible();
    await page.goto("/pass/withdraw");
    await expect(page.getByRole("button", { name: "Withdraw everything" })).toBeVisible({ timeout: 5_000 });
  });

  test("still asks to link when neither the chain nor the index knows a wallet", async ({ page }) => {
    await mockApi(page, { passport: "full", chainWallet: "unlinked" });
    await seedPass(page);
    await page.goto("/pass/withdraw");
    await expect(page.getByText("Link QIE Wallet before you withdraw.")).toBeVisible();
  });
});
