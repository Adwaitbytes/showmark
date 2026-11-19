import { expect, test } from "@playwright/test";
import { recoverTypedDataAddress, getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { decodeDoorPass, encodeAttendeeCode } from "../../src/lib/qr/payload";
import { createState, installMocks, REGISTRY, sampleEvent } from "./mocks";

// The door screen against a mocked chain: it must sign codes with its own door key, rotate them every 15 seconds,
// and show the live count from the registry.

const doorPassTypes = {
  DoorPass: [
    { name: "eventId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "ticket", type: "address" },
  ],
} as const;
const checkInTypes = {
  CheckIn: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "mode", type: "uint8" },
  ],
} as const;
const domain = { name: "Showmark", version: "1", chainId: 1983, verifyingContract: REGISTRY } as const;

async function storedDoorKey(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("showmark.door.v1:")) return (JSON.parse(localStorage.getItem(key) ?? "{}") as { address: string }).address;
    }
    return "";
  });
}

test("shows a signed code that rotates every 15 seconds and the live count", async ({ page }) => {
  test.setTimeout(75_000);
  const state = await installMocks(page, createState({ authorizeAll: true }));
  await page.goto("/door/1");

  await expect(page.getByTestId("door-event-name")).toHaveText("Builders night at Hall B");
  await expect(page.getByTestId("door-count")).toHaveText("41");
  await expect(page.getByText("Open your camera and point it here")).toBeVisible();

  const qr = page.getByTestId("door-qr");
  // The first code appears straight away, not at the next rotation.
  await expect(qr).toHaveAttribute("data-url", /\/c\/1\.\d+\.[A-Za-z0-9_-]{87}\.[A-Za-z0-9_-]{43}$/, { timeout: 4_000 });
  const firstUrl = (await qr.getAttribute("data-url")) ?? "";
  const first = decodeDoorPass(firstUrl);
  expect(first).not.toBeNull();
  if (!first) return;

  // The code is signed by the key this browser stored, under the registry's EIP-712 domain.
  const doorKey = await storedDoorKey(page);
  const signer = await recoverTypedDataAddress({ domain, types: doorPassTypes, primaryType: "DoorPass", message: { eventId: 1n, issuedAt: first.issuedAt, ticket: privateKeyToAccount(first.ticketKey).address }, signature: first.doorSig });
  expect(getAddress(signer)).toBe(getAddress(doorKey));
  expect(Math.abs(Number(first.issuedAt) - Date.now() / 1000)).toBeLessThan(20);

  // A new code within one rotation, issued about 15 seconds later.
  await expect(qr).not.toHaveAttribute("data-url", firstUrl, { timeout: 17_000 });
  const second = decodeDoorPass((await qr.getAttribute("data-url")) ?? "");
  expect(second).not.toBeNull();
  // Every rotation carries its own ticket key.
  expect(second!.ticketKey).not.toBe(first.ticketKey);
  const gap = Number(second!.issuedAt - first.issuedAt);
  expect(gap).toBeGreaterThanOrEqual(1);
  expect(gap).toBeLessThanOrEqual(16);
  const third = await (async () => {
    const before = await qr.getAttribute("data-url");
    await expect(qr).not.toHaveAttribute("data-url", before ?? "", { timeout: 17_000 });
    return decodeDoorPass((await qr.getAttribute("data-url")) ?? "");
  })();
  expect(Number(third!.issuedAt - second!.issuedAt)).toBeGreaterThanOrEqual(14);
  expect(Number(third!.issuedAt - second!.issuedAt)).toBeLessThanOrEqual(16);

  // The count follows the registry.
  state.events.get(1n)!.checkedIn = 42;
  await expect(page.getByTestId("door-count")).toHaveText("42", { timeout: 8_000 });
});

test("asks the organizer to authorize a new door key once, then starts the door", async ({ page }) => {
  const state = await installMocks(page, createState());
  await page.goto("/door/1");
  await expect(page.getByRole("heading", { name: "Make this device the door" })).toBeVisible();
  await expect(page.getByText(/gas fee of about 0\.000225 QIE/)).toBeVisible();
  await page.getByRole("button", { name: "Authorize this device" }).click();
  await expect(page.getByTestId("door-qr")).toHaveAttribute("data-url", /\/c\/1\./, { timeout: 30_000 });
  expect(state.sent).toHaveLength(1);
  expect(state.doorKeys.get((await storedDoorKey(page)).toLowerCase())).toBe(BigInt(state.events.get(1n)!.endsAt + 3600));
});

test("tells the organizer when check-in has not opened yet", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  const state = createState({ authorizeAll: true });
  state.events.set(1n, sampleEvent({ startsAt: now + 6 * 3600, endsAt: now + 9 * 3600 }));
  await installMocks(page, state);
  await page.goto("/door/1");
  await expect(page.getByText(/Check-in opens at/)).toBeVisible();
  await expect(page.getByTestId("door-qr")).toHaveCount(0);
});

test("explains an unknown event", async ({ page }) => {
  await installMocks(page, createState({ authorizeAll: true }));
  await page.goto("/door/99");
  await expect(page.getByRole("heading", { name: "There is no event 99 on Showmark" })).toBeVisible();
});

test("door scans you: signs an attestation for a scanned code and queues it when offline", async ({ page, context }) => {
  const state = await installMocks(page, createState({ authorizeAll: true }));
  await page.goto("/door/1/scan");
  await expect(page.getByRole("heading", { name: "Builders night at Hall B" })).toBeVisible();

  const attendee = privateKeyToAccount(generatePrivateKey());
  const attendeeSig = await attendee.signTypedData({
    domain,
    types: checkInTypes,
    primaryType: "CheckIn",
    message: { eventId: 1n, attendee: attendee.address, mode: 2 },
  });
  await page.getByLabel("Or type a code").fill(encodeAttendeeCode({ eventId: 1n, attendee: attendee.address, attendeeSig }));
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByTestId("scan-result")).toHaveAttribute("data-tone", "success");
  expect(state.checkInsPosted).toHaveLength(1);
  expect(state.checkInsPosted[0]).toMatchObject({
    eventId: "1",
    attendee: attendee.address,
    mode: 2,
    ticket: "0x0000000000000000000000000000000000000000",
    ticketSig: "0x",
  });

  // Offline: the next scan is saved on the device and sent in a batch when the connection returns.
  await context.setOffline(true);
  const second = privateKeyToAccount(generatePrivateKey());
  const secondSig = await second.signTypedData({
    domain,
    types: checkInTypes,
    primaryType: "CheckIn",
    message: { eventId: 1n, attendee: second.address, mode: 2 },
  });
  await page.getByLabel("Or type a code").fill(encodeAttendeeCode({ eventId: 1n, attendee: second.address, attendeeSig: secondSig }));
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByTestId("scan-result")).toHaveAttribute("data-tone", "queued");
  await expect(page.getByTestId("queue-pending")).toHaveText("1");
  await context.setOffline(false);
  await expect(page.getByTestId("queue-pending")).toHaveText("0", { timeout: 15_000 });
  await expect(page.getByTestId("queue-state")).toHaveText("All sent");
  expect(state.checkInsPosted).toHaveLength(2);
});
