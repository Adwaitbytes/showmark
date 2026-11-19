/**
 * Test doubles for the attendee e2e tests and the visual capture. Every value here is made up for
 * tests and screenshots only; the app never imports this file. Door codes are signed for real
 * with throwaway keys, so the app's decoding and signing run exactly as they do at a door.
 */
import type { Page, Route } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { doorPassUrl } from "../../src/lib/qr/payload";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1983);
export const REGISTRY: Address = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as Address | undefined) ?? zeroAddress;

export const TX_CHECK_IN: Hex = "0x5c1f9e2d7b3a8c4e6f0d1b9a2c7e5f3d8b4a6c0e9f1d2b7a3c5e8f4d6b0a9c1e";
export const TX_LINK: Hex = "0x9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d5e4f30211203f4e5d6c7b8a9";
export const TX_WITHDRAW: Hex = "0x1111aaaa2222bbbb3333cccc4444dddd5555eeee6666ffff7777000088889999";

const domain = { name: "Showmark", version: "1", chainId: CHAIN_ID, verifyingContract: REGISTRY } as const;

/** A door code path signed by a throwaway door key, issued now, carrying a fresh ticket key. */
export async function doorPath(eventId = 12n): Promise<string> {
  const door = privateKeyToAccount(generatePrivateKey());
  const ticketKey = generatePrivateKey();
  const ticket = privateKeyToAccount(ticketKey).address;
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const doorSig = await door.signTypedData({
    domain,
    types: {
      DoorPass: [
        { name: "eventId", type: "uint256" },
        { name: "issuedAt", type: "uint64" },
        { name: "ticket", type: "address" },
      ],
    },
    primaryType: "DoorPass",
    message: { eventId, issuedAt, ticket },
  });
  return new URL(doorPassUrl("http://test.local", { eventId, issuedAt, doorSig, ticketKey })).pathname;
}

export const domainForTests = domain;

/** A fixed pass key so screenshots and passport mocks line up. Test-only. */
export const TEST_PASS_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const TEST_PASS = privateKeyToAccount(TEST_PASS_KEY).address;
export const TEST_WALLET: Address = getAddress("0x2f9d41ae7b3c5e8d1a6f0b4c9e2d7a5b3c1e8f06");
export const QUSDC: Address = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

export function testEvent(id = "12", overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizer: "0x91C4e2B7a3D5f8E1c6A9b0D4e7F2a5C8b1D3e6F9",
    organizerName: "campusweb3.qie",
    startsAt: hoursFromNow(-0.5),
    endsAt: hoursFromNow(2.5),
    capacity: 180,
    checkedIn: 64,
    maxPassAge: 60,
    seriesId: "3",
    seriesIndex: 4,
    metadata: { v: 1, name: "Builders evening at the library", venue: "Central library, second floor", city: "Pune", description: "Test event." },
    createdTx: TX_CHECK_IN,
    campaigns: [
      { id: "4", name: "Campus reach", sponsorName: "Lattice Labs", token: QUSDC, tokenSymbol: "QUSDC", attendeeAmount: "1200000", requireQieId: true, minProofMode: 1 },
      { id: "5", name: "Night owls", sponsorName: "Kettle Coffee", token: zeroAddress, tokenSymbol: "QIE", attendeeAmount: "2500000000000000000", requireQieId: false, minProofMode: 1 },
    ],
    recentCheckIns: [],
    ...overrides,
  };
}

const stampNames: [string, string][] = [
  ["Builders evening at the library", "Pune"],
  ["Solidity study circle", "Pune"],
  ["Campus hack night", "Bengaluru"],
  ["Design and ship", "Mumbai"],
  ["Founders breakfast", "Pune"],
  ["Zero to mainnet workshop", "Hyderabad"],
  ["Open mic for builders", "Delhi"],
];

export function testPassport(kind: "empty" | "full" | "linked") {
  if (kind === "empty") {
    return { pass: null, wallet: TEST_PASS, qieName: null, holdsQieId: false, stamps: [], streaks: [], claimable: [], pending: [] };
  }
  const stamps = stampNames.map(([eventName, city], i) => ({
    eventId: String(12 - i),
    eventName,
    city,
    at: new Date(Date.UTC(2026, 10, 19 - i * 3, 13, 10 + i)).toISOString(),
    mode: i % 3 === 2 ? 2 : 1,
    tx: TX_CHECK_IN,
    streak: i < 3 ? 3 - i : 0,
  }));
  return {
    pass: TEST_PASS,
    wallet: kind === "linked" ? TEST_WALLET : null,
    qieName: kind === "linked" ? "asha.qie" : null,
    holdsQieId: kind === "linked",
    stamps,
    streaks: [{ seriesId: "3", seriesName: "Pune builders series", current: 3, best: 4 }],
    claimable: [
      { token: zeroAddress, symbol: "QIE", amount: "7500000000000000000" },
      { token: QUSDC, symbol: "QUSDC", amount: "3600000" },
    ],
    pending: kind === "linked" ? [{ campaignId: "6", eventId: "11", reason: "Pending" }] : [
      { campaignId: "4", eventId: "12", reason: "NeedsQieId" },
      { campaignId: "7", eventId: "10", reason: "PriceStale" },
    ],
  };
}

export function testUpcoming() {
  return [testEvent("12"), testEvent("14", { metadata: { v: 1, name: "Solidity study circle", venue: "Room 4", city: "Pune", description: "" } })];
}

export interface MockOptions {
  event?: "ok" | "fail" | "slow";
  eventOverrides?: Record<string, unknown>;
  /** Responses for POST /api/relay/check-in, used in order; the last one repeats. "hang" never answers. */
  checkIn?: (MockResponse | "hang")[];
  /** Responses for GET /api/tx/{hash}, used in order; the last one repeats. */
  tx?: ("pending" | "success" | "reverted")[];
  passport?: "empty" | "full" | "linked" | "fail";
}

export interface MockResponse {
  status: number;
  body: unknown;
}

export const submitted: MockResponse = { status: 200, body: { txHash: TX_CHECK_IN, status: "submitted" } };

export function apiError(status: number, code: string, message: string, action: string): MockResponse {
  return { status, body: { error: { code, message, action } } };
}

export const ERRORS = {
  already: apiError(422, "already_present", "You are already checked in to this event.", "Open your passport to see the stamp."),
  stale: apiError(422, "stale", "The door code expired before it reached the network.", "Scan the code on the door screen again. It changes every 15 seconds."),
  capacity: apiError(422, "at_capacity", "This event is full.", "Ask the organizer whether more places can be opened."),
  window: apiError(422, "outside_event_window", "Check-in is closed for this event right now.", "Check-in opens one hour before the event starts and closes one hour after it ends."),
  down: apiError(503, "upstream_unavailable", "A service Showmark depends on did not answer in time.", "Try again in a few seconds."),
  linkRejected: apiError(422, "link_rejected", "The network rejected this wallet link.", "Sign again in QIE Wallet. Each pass links to one wallet, and each wallet to one pass."),
};

const json = (route: Route, response: MockResponse) =>
  route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });

/** Routes every /api call the attendee screens make. Returns the check-in bodies the app sent. */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<{ checkIns: unknown[] }> {
  const checkIns: unknown[] = [];
  const checkInQueue = [...(options.checkIn ?? [submitted])];
  const txQueue = [...(options.tx ?? ["pending", "success"])];

  await page.route(/\/api\/events\/\d+$/, async (route) => {
    if (options.event === "fail") return json(route, apiError(503, "database_not_configured", "Showmark cannot reach its database right now.", "Try again in a few minutes."));
    if (options.event === "slow") await new Promise((r) => setTimeout(r, 60_000));
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "12";
    return json(route, { status: 200, body: testEvent(id, options.eventOverrides) });
  });
  await page.route(/\/api\/events\?/, (route) => json(route, { status: 200, body: testUpcoming() }));
  await page.route("**/api/relay/check-in", async (route) => {
    checkIns.push(route.request().postDataJSON());
    const next = checkInQueue.length > 1 ? checkInQueue.shift() : checkInQueue[0];
    if (next === "hang" || !next) return; // never answers: the screen stays in "sending"
    return json(route, next);
  });
  await page.route(/\/api\/tx\/0x[0-9a-fA-F]+$/, (route) => {
    const next = txQueue.length > 1 ? txQueue.shift() : txQueue[0];
    return json(route, { status: 200, body: next === "pending" ? { status: "pending" } : { status: next, blockNumber: "4410021" } });
  });
  await page.route(/\/api\/passport\/0x[0-9a-fA-F]{40}$/, (route) => {
    if (options.passport === "fail") return json(route, apiError(503, "chain_read_failed", "Showmark could not read balances from the network.", "Try again in a few seconds."));
    return json(route, { status: 200, body: testPassport(options.passport ?? "empty") });
  });
  await page.route(/\/api\/campaigns\/\d+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return json(route, { status: 200, body: { id, name: "Campus reach", sponsorName: "Lattice Labs", endsAt: "2026-11-30T18:30:00.000Z" } });
  });
  await page.route("**/api/relay/link-wallet", (route) => json(route, { status: 200, body: { txHash: TX_LINK } }));
  await page.route("**/api/relay/withdraw", (route) => json(route, { status: 200, body: { txHash: TX_WITHDRAW } }));
  return { checkIns };
}

/** Puts the fixed test pass on the phone before any page script runs. */
export async function seedPass(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem("showmark.pass.v1", JSON.stringify({ version: 1, privateKey: key, createdAt: "2026-11-19T10:00:00.000Z", origin: "random" }));
  }, TEST_PASS_KEY);
}

/**
 * A stand-in QIE Wallet announced over EIP-6963, already on the app's chain. It returns a fixed,
 * well-formed signature: the relay is mocked, so nothing verifies it. Test-only.
 */
export async function installFakeWallet(page: Page): Promise<void> {
  await page.addInitScript(
    ({ account, chainId }) => {
      const provider = {
        async request({ method }: { method: string }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
          if (method === "eth_signTypedData_v4") return `0x${"ab".repeat(64)}1b`;
          if (method === "wallet_switchEthereumChain") return null;
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
        },
        on() {},
        removeListener() {},
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info: { uuid: "test-qie-wallet", name: "QIE Wallet", icon: "", rdns: "me.qiewallet" }, provider }),
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
    },
    { account: TEST_WALLET, chainId: CHAIN_ID },
  );
}
