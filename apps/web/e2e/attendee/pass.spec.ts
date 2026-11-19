import { expect, test } from "@playwright/test";
import { doorPath, mockApi, seedPass } from "./fixtures";

// Client-side navigations into the passport must load it, not leave it on skeletons. Regression for a
// production bug: /pass stayed on skeletons after "Open my passport" until a hard reload.

const stampsLoaded = async (page: import("@playwright/test").Page) => {
  const main = page.locator("main:visible");
  await expect(main.getByRole("heading", { level: 1, name: "Your passport" })).toBeVisible();
  await expect(main.getByText("Solidity study circle", { exact: true })).toBeVisible({ timeout: 5_000 });
};

test.describe("navigating to the passport", () => {
  // The Next.js dev tools badge sits over the bottom tab bar in development builds.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; }";
        document.head.append(style);
      });
    });
  });

  test("loads after checking in and tapping Open my passport", async ({ page }) => {
    await mockApi(page, { passport: "full", tx: ["success"] });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();
    await page.getByRole("link", { name: "Open my passport" }).click();
    await stampsLoaded(page);
  });

  test("loads after a check-in when the passport was opened earlier, before this phone had a pass", async ({ page }) => {
    // Next keeps visited routes mounted but hidden (Activity), so /pass from the first visit is reused.
    await mockApi(page, { passport: "full", tx: ["pending", "success"] });
    await page.goto("/pass");
    await expect(page.getByText("This phone has no pass yet.", { exact: false })).toBeVisible();
    const door = await doorPath(12n);
    await page.evaluate((href) => (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(href), door);
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();
    await page.getByRole("link", { name: "Open my passport" }).click();
    await expect(page.locator("main:visible").getByText("Solidity study circle", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("loads from the bottom tab bar", async ({ page }) => {
    await mockApi(page, { passport: "full" });
    await seedPass(page);
    await page.goto("/scan");
    await page.getByRole("navigation", { name: "Attendee" }).getByRole("link", { name: "Passport" }).last().click();
    await stampsLoaded(page);
  });

  test("loads when going back from the link screen", async ({ page }) => {
    await mockApi(page, { passport: "full" });
    await seedPass(page);
    await page.goto("/pass/link");
    await page.getByRole("link", { name: "Back to passport" }).click();
    await stampsLoaded(page);
  });

  test("loads again when coming back to it after visiting another screen", async ({ page }) => {
    await mockApi(page, { passport: "full" });
    await seedPass(page);
    await page.goto("/pass");
    await stampsLoaded(page);
    await page.getByRole("link", { name: "Link QIE Wallet to withdraw" }).click();
    await page.getByRole("link", { name: "Back to passport" }).click();
    await stampsLoaded(page);
  });
});
