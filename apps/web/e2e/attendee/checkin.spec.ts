import { expect, test } from "@playwright/test";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { doorPath, domainForTests, ERRORS, mockApi, queued, submitted, TX_CHECK_IN } from "./fixtures";

// The check-in screen at 390 x 844 with the relay mocked. Each test is a stranger at a door who has
// just pointed their camera at the code.

test.describe("check-in from a door code", () => {
  test("checks in on load, shows the pending stamp, then the pressed stamp with the receipt", async ({ page }) => {
    const { checkIns, seen } = await mockApi(page, { tx: ["pending", "pending", "success"] });
    const path = await doorPath(12n);
    const serverUrls: string[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith("http://localhost")) serverUrls.push(r.url() + (r.postData() ?? ""));
    });
    await page.goto(path);

    await expect(page.getByText("Builders evening at the library", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Recording your stamp on QIE" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();

    await expect(page.getByRole("img", { name: /Builders evening at the library/ })).toBeVisible();
    const explorer = page.getByRole("link", { name: /transaction 0x5c1f9e2d/ });
    await expect(explorer).toHaveAttribute("href", new RegExp(`/tx/${TX_CHECK_IN}$`));
    await expect(page.getByRole("link", { name: "Open my passport" })).toBeVisible();
    await expect(page.getByText("Lattice Labs pays each verified guest")).toBeVisible();

    // The app signed CheckIn(eventId, attendee, 1) with a pass it created on the spot, and Ticket(eventId, attendee)
    // with the ticket key from the QR, whose address it sends as `ticket`.
    expect(checkIns).toHaveLength(1);
    // Verify against the registry and chain the app is built for, as seen in its own RPC calls.
    await expect.poll(() => seen.registry).not.toBeNull();
    const domain = { ...domainForTests, verifyingContract: seen.registry ?? domainForTests.verifyingContract, chainId: seen.chainId ?? domainForTests.chainId };
    const body = checkIns[0] as { eventId: string; attendee: Address; mode: number; ticket: Address; attendeeSig: Hex; ticketSig: Hex };
    expect(body).toMatchObject({ eventId: "12", mode: 1 });
    const signer = await recoverTypedDataAddress({
      domain,
      types: { CheckIn: [{ name: "eventId", type: "uint256" }, { name: "attendee", type: "address" }, { name: "mode", type: "uint8" }] },
      primaryType: "CheckIn",
      message: { eventId: 12n, attendee: body.attendee, mode: 1 },
      signature: body.attendeeSig,
    });
    expect(signer).toBe(body.attendee);
    const ticketSigner = await recoverTypedDataAddress({
      domain,
      types: { Ticket: [{ name: "eventId", type: "uint256" }, { name: "attendee", type: "address" }] },
      primaryType: "Ticket",
      message: { eventId: 12n, attendee: body.attendee },
      signature: body.ticketSig,
    });
    expect(ticketSigner).toBe(body.ticket);
    // The ticket key lives only in the fragment: never in a request to our server, never in storage,
    // and gone from the address bar once read.
    const ticketKey = path.split("#")[1];
    expect(JSON.stringify(body)).not.toContain(ticketKey);
    expect(serverUrls.length).toBeGreaterThan(0);
    for (const url of serverUrls) expect(url).not.toContain(ticketKey);
    const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
    expect(stored).not.toContain(ticketKey);
    expect(await page.evaluate(() => window.location.hash)).toBe("");
    expect(page.url()).not.toContain(ticketKey);

    // First stamp on a guest pass: suggest linking a wallet, without blocking anything.
    await expect(page.getByRole("link", { name: "Link QIE Wallet" })).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("link", { name: "Link QIE Wallet" })).toBeHidden();
  });

  test("shows the stamp from the chain when the relay never answers", async ({ page }) => {
    // Live journey finding: the relay broadcast at 2.5 s but its HTTP response never arrived.
    const { checkIns } = await mockApi(page, { checkIn: ["hang"], presenceAfterMs: 2_000 });
    await page.goto(await doorPath(12n));
    await expect.poll(() => checkIns.length).toBe(1);
    const posted = Date.now();
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible({ timeout: 4_000 });
    expect(Date.now() - posted).toBeLessThan(4_000);
    // The transaction is found from the CheckedIn log, so the receipt still links to the explorer.
    await expect(page.getByRole("link", { name: /transaction 0x5c1f9e2d/ })).toBeVisible({ timeout: 4_000 });
  });

  test("treats a queued relay answer as progress and stamps once the queue has the hash", async ({ page }) => {
    const { checkIns } = await mockApi(page, { checkIn: [queued], queuedHashAfterMs: 2_000, tx: ["success"] });
    await page.goto(await doorPath(12n));
    await expect(page.getByText("Showmark has your check-in and is sending it to QIE.", { exact: false })).toBeVisible();
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("link", { name: /transaction 0x5c1f9e2d/ })).toBeVisible();
    // Queued means the relay holds it: one POST, never resent.
    expect(checkIns).toHaveLength(1);
  });

  test("stamps from the chain while the relay queue still says queued", async ({ page }) => {
    const { checkIns } = await mockApi(page, { checkIn: [queued], presenceAfterMs: 2_000 });
    await page.goto(await doorPath(12n));
    await expect.poll(() => checkIns.length).toBe(1);
    const posted = Date.now();
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible({ timeout: 4_000 });
    expect(Date.now() - posted).toBeLessThan(4_000);
    expect(checkIns).toHaveLength(1);
  });

  test("shows the stamp they already have instead of an error", async ({ page }) => {
    await mockApi(page, { checkIn: [ERRORS.already] });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "You were already checked in" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Builders evening at the library/ })).toBeVisible();
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
  });

  test("asks for the current code when the door code went stale", async ({ page }) => {
    await mockApi(page, { checkIn: [ERRORS.stale] });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "The door code expired before it reached the network." })).toBeVisible();
    await expect(page.getByText("It changes every 15 seconds.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Scan the door code" })).toHaveAttribute("href", "/scan");
  });

  test("says the event is full", async ({ page }) => {
    await mockApi(page, { checkIn: [ERRORS.capacity] });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "This event is full." })).toBeVisible();
  });

  test("says when check-in opens for an event that has not started", async ({ page }) => {
    await mockApi(page, {
      checkIn: [ERRORS.window],
      eventOverrides: { startsAt: new Date(Date.now() + 5 * 3_600_000).toISOString(), endsAt: new Date(Date.now() + 8 * 3_600_000).toISOString() },
    });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "Check-in is closed for this event right now." })).toBeVisible();
    await expect(page.getByText(/Check-in for this event opens at/)).toBeVisible();
  });

  test("keeps the signed check-in while the relay is down and sends it when it is back", async ({ page }) => {
    const { checkIns } = await mockApi(page, { checkIn: [ERRORS.down, ERRORS.down, submitted], tx: ["success"] });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "Your check-in is saved on this phone" })).toBeVisible();
    await page.getByRole("button", { name: "Try now" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();
    expect(checkIns.length).toBeGreaterThanOrEqual(3);
    // Every attempt resent the same signed check-in.
    expect(new Set(checkIns.map((c) => JSON.stringify(c))).size).toBe(1);
  });

  test("waits out a lost connection and checks in when the phone is back online", async ({ page, context }) => {
    await mockApi(page, { tx: ["success"] });
    let attempts = 0;
    // Registered after mockApi, so it wins: the first send happens as the phone loses its signal.
    await page.route("**/api/relay/check-in", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await context.setOffline(true);
        return route.abort("internetdisconnected");
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(submitted.body) });
    });
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "Your check-in is saved on this phone" })).toBeVisible();
    await expect(page.getByText("Your phone is offline.")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("says the link lost part of the door code when the fragment is missing", async ({ page }) => {
    const { checkIns } = await mockApi(page);
    const path = await doorPath(12n);
    await page.goto(path.split("#")[0]);
    await expect(page.getByRole("heading", { level: 1, name: "This link is missing part of the door code." })).toBeVisible();
    await expect(page.getByText("Scan the code on the door screen again.")).toBeVisible();
    expect(checkIns).toHaveLength(0);
  });

  test("checks in after an in-app navigation that carries the fragment, as the scanner does", async ({ page }) => {
    await mockApi(page);
    await page.goto("/scan");
    const path = await doorPath(12n);
    // The scanner calls router.push(`/c/${encodeDoorPass(door)}`), which keeps the #ticketKey.
    await page.evaluate((p) => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(p), path);
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toBe("");
  });

  test("explains a link that is not a door code", async ({ page }) => {
    await mockApi(page);
    await page.goto("/c/not-a-door-code");
    await expect(page.getByRole("heading", { level: 1, name: "This link is not a Showmark door code." })).toBeVisible();
  });

  test("switches to Hindi and stays in Hindi", async ({ page }) => {
    await mockApi(page);
    await page.goto(await doorPath(12n));
    await expect(page.getByRole("heading", { level: 1, name: "You are checked in" })).toBeVisible();
    await page.getByRole("button", { name: "Switch the language to Hindi" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "आपका चेक इन हो गया" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.goto("/pass");
    await expect(page.getByRole("heading", { level: 1, name: "आपका पासपोर्ट" })).toBeVisible();
  });
});
