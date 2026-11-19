/**
 * Wallet journeys on the production URL against QIE testnet, with real transactions from the throwaway test key.
 * Runs in order and shares state (event ids, campaign ids, attendee contexts) between steps:
 *
 *   pnpm --filter web exec playwright test -c e2e/live/playwright.config.ts
 *
 * Every wallet transaction, relayed transaction, timing and screenshot lands in docs/qa/live/ (run.json + JPEGs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";
import jsQR from "jsqr";
import { formatEther, getAddress, parseEther, parseEventLogs, type Hex } from "viem";
import { registryAbi, vaultAbi } from "../../src/lib/chain/abi";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BASE_URL, CHAIN_ID, EXPLORER, QA_DIR, deployment } from "./env";
import { estimateLog, injectWallet, publicClient, walletAddress, walletLog } from "./wallet";

test.describe.configure({ mode: "serial" });

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;
const TIMEZONE = "Asia/Kolkata";

/**
 * LIVE_RESUME_PHONE="eventId:campaignId:event name" reuses a phone event and campaign an earlier run created, funded
 * and approved, so a rerun after a late failure does not lock another deposit. The door still gets a fresh key.
 */
function resumeFrom(variable: string) {
  const raw = process.env[variable];
  if (!raw) return null;
  const [eventId, campaignId, ...name] = raw.split(":");
  if (!/^\d+$/.test(eventId ?? "") || !/^\d+$/.test(campaignId ?? "") || name.length === 0) throw new Error(`${variable} is eventId:campaignId:name`);
  return { eventId, campaignId, eventName: name.join(":") };
}
const RESUME_PHONE = resumeFrom("LIVE_RESUME_PHONE");
/** Same for the 1440x900 pass. Approves the event if the earlier run stopped before that. */
const RESUME_DESKTOP = resumeFrom("LIVE_RESUME_DESKTOP");

function eventName(viewport: string): string {
  const e = run.events.find((x) => x.viewport === viewport);
  if (!e) throw new Error(`no ${viewport} event in this run`);
  return e.name;
}

interface Timing {
  label: string;
  ms: number;
}
interface RelayedTx {
  label: string;
  hash: Hex;
}
interface PageProblem {
  context: string;
  kind: "console" | "pageerror" | "requestfailed" | "http" | "slow";
  text: string;
}

const run = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  chainId: CHAIN_ID,
  wallet: walletAddress,
  journeys: {} as Record<string, { status: "passed" | "failed"; notes: string[] }>,
  events: [] as { viewport: string; eventId: string; name: string }[],
  campaigns: [] as { viewport: string; campaignId: string }[],
  relayed: [] as RelayedTx[],
  timings: [] as Timing[],
  balances: {} as Record<string, string>,
  problems: [] as PageProblem[],
  attendeeTraces: [] as { tag: string; trace: string[] }[],
  screenshots: [] as string[],
};

function save() {
  mkdirSync(QA_DIR, { recursive: true });
  writeFileSync(
    path.join(QA_DIR, `run${process.env.LIVE_RUN_NAME ? `-${process.env.LIVE_RUN_NAME}` : ""}.json`),
    JSON.stringify({ ...run, walletLog, estimateLog }, null, 2) + "\n",
  );
}

function note(journey: string, text: string) {
  (run.journeys[journey] ??= { status: "failed", notes: [] }).notes.push(text);
  save();
}

async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(QA_DIR, { recursive: true });
  const file = `${name}.jpg`;
  await page.screenshot({ path: path.join(QA_DIR, file), type: "jpeg", quality: 70, fullPage });
  run.screenshots.push(file);
  save();
}

const pendingRequests = new WeakMap<Page, Map<Request, number>>();

/** Records requests that never finished, for a step that timed out. */
function dumpPending(page: Page, label: string) {
  for (const [r, at] of pendingRequests.get(page) ?? []) {
    run.problems.push({ context: label, kind: "slow", text: `still pending after ${Date.now() - at}ms: ${r.method()} ${r.url()}`.slice(0, 600) });
  }
  save();
}

function watch(page: Page, label: string) {
  page.on("console", (m) => {
    if (m.type() === "error") run.problems.push({ context: label, kind: "console", text: `${page.url()} :: ${m.text()}`.slice(0, 600) });
  });
  page.on("pageerror", (e) => run.problems.push({ context: label, kind: "pageerror", text: `${page.url()} :: ${e.message}`.slice(0, 600) }));
  page.on("requestfailed", (r) => {
    const failure = r.failure()?.errorText ?? "";
    // Aborted prefetches and navigations away from a pending request are normal browser behaviour.
    if (failure.includes("ERR_ABORTED")) return;
    run.problems.push({ context: label, kind: "requestfailed", text: `${r.method()} ${r.url()} :: ${failure}`.slice(0, 600) });
  });
  // Slow requests are recorded too: a sign-in once hung for 30 s with no error at all.
  const started = new Map<Request, number>();
  pendingRequests.set(page, started);
  page.on("request", (r) => started.set(r, Date.now()));
  page.on("requestfailed", (r) => started.delete(r));
  page.on("requestfinished", (r) => {
    const ms = Date.now() - (started.get(r) ?? Date.now());
    started.delete(r);
    if (ms > 3000) run.problems.push({ context: label, kind: "slow", text: `${ms}ms ${r.method()} ${r.url()}`.slice(0, 600) });
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      run.problems.push({ context: label, kind: "http", text: `${r.status()} ${r.request().method()} ${r.url()}`.slice(0, 600) });
  });
}

async function newContext(browser: Browser, viewport: { width: number; height: number }, withWallet: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    timezoneId: TIMEZONE,
    locale: "en-IN",
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    deviceScaleFactor: viewport.width < 500 ? 2 : 1,
  });
  if (withWallet) await injectWallet(context);
  return context;
}

/** datetime-local value in the browser's zone (IST), rounded down to the minute. */
function istLocal(ms: number): string {
  const d = new Date(ms + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}

/** Rasterizes the door's SVG code in the page and decodes it in Node with jsQR. */
async function readDoorLink(page: Page): Promise<{ link: string; issuedAt: string | null }> {
  const qr = page.getByTestId("door-qr");
  await expect(qr.locator("svg").first()).toBeVisible({ timeout: 60_000 });
  const issuedAt = await qr.getAttribute("data-issued-at");
  const size = 480;
  const b64 = await qr
    .locator("svg")
    .first()
    .evaluate(async (svg, px) => {
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, px * 0.08, px * 0.08, px * 0.84, px * 0.84);
      const data = ctx.getImageData(0, 0, px, px).data;
      let binary = "";
      for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(binary);
    }, size);
  const pixels = new Uint8ClampedArray(Buffer.from(b64, "base64"));
  const decoded = jsQR(pixels, size, size);
  if (!decoded) throw new Error("jsQR could not read the door code");
  return { link: decoded.data, issuedAt };
}

function assertDoorLink(link: string) {
  const url = new URL(link);
  expect(url.origin).toBe(new URL(BASE_URL).origin);
  expect(url.pathname).toMatch(/^\/c\/[A-Za-z0-9_.-]+$/);
  expect(url.hash.length).toBeGreaterThan(10);
}

async function doorCount(page: Page): Promise<number> {
  const text = (await page.getByTestId("door-count").innerText()).replace(/[^\d]/g, "");
  return Number(text || "0");
}

/** The newest wallet transaction that called `fn`. */
function lastTx(fn: string): Hex {
  const tx = [...walletLog.txs].reverse().find((t) => t.functionName === fn);
  if (!tx) throw new Error(`no ${fn} transaction was sent`);
  return tx.hash;
}

async function confirmed(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  expect(receipt.status, `${hash} status`).toBe("success");
  return receipt;
}

// ------------------------------------------------------------------------------------------ shared state

let operatorPhone: BrowserContext;
let operatorDesktop: BrowserContext;
let doorPhone: Page;
let doorDesktop: Page;
let eventPhone = "";
let eventDesktop = "";
let campaignPhone = "";
let campaignDesktop = "";
let paidAttendee: BrowserContext | null = null;
const attendees: BrowserContext[] = [];

test.afterAll(async () => {
  run.balances.walletEnd = formatEther(await publicClient.getBalance({ address: walletAddress }));
  save();
  for (const c of [operatorPhone, operatorDesktop, ...attendees]) await c?.close().catch(() => undefined);
});

async function signInOrganizer(page: Page, tag: string) {
  await page.goto(`${BASE_URL}/organize`);
  const signIn = page.getByRole("button", { name: /^Sign in with QIE (Wallet|ID)$/ });
  const console_ = page.getByRole("heading", { name: "Your events" });
  await expect(signIn.or(console_)).toBeVisible({ timeout: 30_000 });
  await shot(page, `${tag}-01-organize-signin`);
  if (await signIn.isVisible()) {
    const before = walletLog.signatures.length;
    await signIn.click();
    await expect(console_)
      .toBeVisible({ timeout: 30_000 })
      .catch(async (error: unknown) => {
        dumpPending(page, `${tag} organizer sign-in`);
        await shot(page, `${tag}-02-organize-signin-stuck`);
        throw error;
      });
    expect(walletLog.signatures.length).toBeGreaterThan(before);
  }
  await shot(page, `${tag}-02-organize-console`);
}

async function createEvent(page: Page, tag: string, name: string): Promise<string> {
  await page.goto(`${BASE_URL}/organize/new`);
  await expect(page.getByRole("heading", { name: "Create an event" })).toBeVisible({ timeout: 30_000 });
  const now = Date.now();
  await page.locator("#event-name").fill(name);
  await page.locator("#event-venue").fill("Harness bench");
  await page.locator("#event-city").fill("Bengaluru");
  await page.locator("#event-description").fill("Automated wallet journey on QIE testnet.");
  await page.locator("#event-startsAt").fill(istLocal(now));
  await page.locator("#event-endsAt").fill(istLocal(now + 2 * 86_400_000));
  await page.locator("#event-capacity").fill("50");
  const submit = page.getByRole("button", { name: "Create the event" });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await shot(page, `${tag}-03-new-event-form`, true);
  const sent = walletLog.txs.length;
  await submit.click();
  const done = page.getByRole("heading", { name: /is event \d+$/ });
  await expect(done).toBeVisible({ timeout: 90_000 });
  expect(walletLog.txs.length).toBe(sent + 1);
  const id = /is event (\d+)$/.exec((await done.innerText()).trim())?.[1];
  if (!id) throw new Error("no event id in the success heading");
  await confirmed(lastTx("createEvent"));
  await shot(page, `${tag}-04-event-created`);
  return id;
}

async function openDoor(context: BrowserContext, tag: string, eventId: string, journey: string): Promise<Page> {
  const page = await context.newPage();
  watch(page, `${tag} door`);
  await page.goto(`${BASE_URL}/door/${eventId}`);
  const connect = page.getByRole("button", { name: "Connect the organizer’s QIE Wallet" });
  const authorize = page.getByRole("button", { name: /^Authorize this device( again)?$/ });
  const qr = page.getByTestId("door-qr");
  await expect(connect.or(authorize).or(qr)).toBeVisible({ timeout: 45_000 });
  await shot(page, `${tag}-05-door-setup`);
  // The page restores a known wallet by itself a moment after load, and React reuses the same <button> for "Connect"
  // and "Authorize". Clicking "Connect" while that happens lands on "Authorize", so give the restore a chance first.
  await expect(authorize.or(qr))
    .toBeVisible({ timeout: 5_000 })
    .catch(() => undefined);
  if (await connect.isVisible()) await connect.click();
  const sentBefore = walletLog.txs.length;
  if (!(await qr.isVisible())) {
    await expect(authorize.or(qr)).toBeVisible({ timeout: 30_000 });
    const t0 = Date.now();
    const sent = walletLog.txs.length;
    if (sent === sentBefore) {
      await expect(authorize).toBeEnabled({ timeout: 30_000 });
      await authorize.click();
    }
    await expect(qr.locator("svg").first()).toBeVisible({ timeout: 120_000 });
    run.timings.push({ label: `${tag} door: authorize click to first QR`, ms: Date.now() - t0 });
    expect(walletLog.txs.length).toBe(sent + 1);
    await confirmed(lastTx("authorizeDoorKey"));
  }
  const { link, issuedAt } = await readDoorLink(page);
  assertDoorLink(link);
  note(journey, `${tag}: door QR decoded to ${new URL(link).origin}/c/… with a fragment (issuedAt ${issuedAt})`);
  await shot(page, `${tag}-06-door-qr`);
  return page;
}

/** Opens a fresh door link in a new wallet-less phone context and waits for the stamp. Returns the context. */
async function attendeeCheckIn(browser: Browser, door: Page, tag: string): Promise<{ context: BrowserContext; ms: number; checkInTx: Hex }> {
  const context = await newContext(browser, PHONE, false);
  attendees.push(context);
  const page = await context.newPage();
  watch(page, `${tag} attendee`);
  const before = await doorCount(door);
  const { link } = await readDoorLink(door);
  assertDoorLink(link);
  const t0 = Date.now();
  const trace: string[] = [];
  const started = new Map<Request, number>();
  page.on("request", (r) => {
    started.set(r, Date.now());
    if (/\/api\/(relay|tx)\//.test(r.url())) trace.push(`+${Date.now() - t0}ms -> ${r.method()} ${new URL(r.url()).pathname}`);
  });
  // Anything slow on the way to the stamp: page, chunks, API calls.
  const slow = (r: Request, outcome: string) => {
    const at = started.get(r);
    if (at !== undefined && Date.now() - at > 2000)
      trace.push(`+${Date.now() - t0}ms slow ${outcome} ${Date.now() - at}ms ${r.resourceType()} ${r.url().slice(0, 140)}`);
  };
  page.on("requestfinished", (r) => slow(r, "finished"));
  page.on("requestfailed", (r) => slow(r, `failed (${r.failure()?.errorText ?? ""})`));
  page.on("domcontentloaded", () => trace.push(`+${Date.now() - t0}ms domcontentloaded`));
  page.on("load", () => trace.push(`+${Date.now() - t0}ms load`));
  page.on("response", async (r) => {
    if (!/\/api\/(relay|tx)\//.test(r.url())) return;
    const body = await r.text().catch(() => "");
    trace.push(`+${Date.now() - t0}ms <- ${r.status()} ${new URL(r.url()).pathname} ${body.slice(0, 160)}`);
  });
  await page.goto(link);
  const stamped = page.getByText("You are checked in", { exact: true });
  const tap = page.getByRole("button", { name: "Check in", exact: true });
  await expect(stamped.or(tap)).toBeVisible({ timeout: 60_000 });
  if (!(await stamped.isVisible())) await tap.click();
  await expect(stamped).toBeVisible({ timeout: 60_000 });
  const ms = Date.now() - t0;
  run.timings.push({ label: `${tag}: door link opened to "You are checked in"`, ms });
  run.attendeeTraces.push({ tag, trace });
  for (const line of trace) {
    const hash = /"txHash":"(0x[0-9a-f]{64})"/.exec(line)?.[1];
    if (hash && !run.relayed.some((r) => r.hash === hash)) run.relayed.push({ label: `${tag}: check-in (relayed checkInBatch)`, hash: hash as Hex });
  }
  expect(page.url()).not.toContain("#");
  await shot(page, `${tag}-attendee-checked-in`);
  const t1 = Date.now();
  await expect.poll(() => doorCount(door), { timeout: 60_000, intervals: [1000] }).toBe(before + 1);
  run.timings.push({ label: `${tag}: stamp shown to door count +1`, ms: Date.now() - t1 });
  await shot(door, `${tag}-door-count-${before + 1}`);
  const checkInTx = run.relayed.find((r) => r.label === `${tag}: check-in (relayed checkInBatch)`)?.hash;
  if (!checkInTx) throw new Error("the relay never returned a check-in transaction");
  return { context, ms, checkInTx };
}

async function signInSponsor(page: Page, tag: string) {
  await page.goto(`${BASE_URL}/sponsor`);
  const connect = page.getByRole("button", { name: "Connect QIE Wallet" });
  const signIn = page.getByRole("button", { name: "Sign in with QIE Wallet" });
  const newCampaign = page.getByRole("link", { name: /new campaign|create a campaign|start a campaign/i }).first();
  await expect(connect.or(signIn).or(newCampaign)).toBeVisible({ timeout: 30_000 });
  await shot(page, `${tag}-01-sponsor-gate`);
  if (await connect.isVisible()) await connect.click();
  if (await signIn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    const before = walletLog.signatures.length;
    await signIn.click();
    await expect.poll(() => walletLog.signatures.length, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect(signIn).toBeHidden({ timeout: 30_000 });
  }
  await shot(page, `${tag}-02-sponsor-home`);
}

async function createCampaign(page: Page, tag: string, name: string): Promise<string> {
  await page.goto(`${BASE_URL}/sponsor/new`);
  await expect(page.locator("#amount")).toBeVisible({ timeout: 30_000 });
  await page.locator('input[name="token"][value="QIE"]').check({ force: true });
  await page.locator('input[name="pricing"][value="token"]').check({ force: true });
  await page.locator("#amount").fill("0.01");
  await page.locator('input[name="minProofMode"][value="1"]').check({ force: true });
  const qieId = page.locator("#requireQieId");
  if (await qieId.isChecked()) await qieId.uncheck({ force: true });
  await page.locator('input[name="openToBonded"][value="no"]').check({ force: true });
  await page.locator("#name").fill(name);
  await page.locator("#sponsorName").fill("Showmark QA");
  await page.locator("#description").fill("Automated wallet journey on QIE testnet.");
  await page.locator("#deposit").fill("0.05");
  await shot(page, `${tag}-03-new-campaign-form`, true);
  await page.getByRole("button", { name: "Review and fund" }).click();
  const deposit = page.getByRole("button", { name: /^Deposit 0\.05 QIE$/ });
  await expect(deposit).toBeEnabled({ timeout: 30_000 });
  await shot(page, `${tag}-04-fund-step`);
  const sent = walletLog.txs.length;
  await deposit.click();
  const approveLink = page.getByRole("link", { name: "Approve events" });
  await expect(approveLink).toBeVisible({ timeout: 90_000 });
  expect(walletLog.txs.length).toBe(sent + 1);
  const receipt = await confirmed(walletLog.txs[walletLog.txs.length - 1].hash);
  expect(getAddress(receipt.to ?? "0x0000000000000000000000000000000000000000")).toBe(getAddress(deployment.vault));
  const href = await approveLink.getAttribute("href");
  const id = /\/sponsor\/(\d+)/.exec(href ?? "")?.[1];
  if (!id) throw new Error(`no campaign id in ${href}`);
  await shot(page, `${tag}-05-campaign-created`);
  return id;
}

async function approveEvent(page: Page, tag: string, campaignId: string, eventId: string, eventName: string) {
  await page.goto(`${BASE_URL}/sponsor/${campaignId}`);
  const search = page.locator("#event-search");
  await expect(search).toBeVisible({ timeout: 45_000 });
  const row = page.getByRole("list", { name: "Events you can approve" }).getByRole("listitem").filter({ hasText: eventName });
  // The new event reaches the index a few seconds after its transaction.
  await expect
    .poll(
      async () => {
        await search.fill(`#${eventId}`);
        if (
          await row
            .first()
            .isVisible({ timeout: 4000 })
            .catch(() => false)
        )
          return true;
        await search.fill(eventName);
        return row
          .first()
          .isVisible({ timeout: 4000 })
          .catch(() => false);
      },
      { timeout: 120_000, intervals: [3000] },
    )
    .toBe(true);
  const approved = row.first().getByText("Approved");
  const rejected = page.getByText("The transaction was mined but the vault rejected it.");
  for (let attempt = 1; ; attempt++) {
    const sent = walletLog.txs.length;
    await row.first().getByRole("button", { name: "Approve" }).click();
    await expect(approved.or(rejected).first()).toBeVisible({ timeout: 90_000 });
    expect(walletLog.txs.length).toBe(sent + 1);
    if (await approved.isVisible()) break;
    const failed = walletLog.txs[walletLog.txs.length - 1];
    note(
      "bugs",
      `${tag}: approveEvents attempt ${attempt} reverted on chain: ${failed.hash} (gas from dapp ${failed.gasFromDapp}, estimated ${failed.gasEstimated})`,
    );
    await shot(page, `${tag}-06-approve-rejected-${attempt}`);
    if (attempt >= 2) throw new Error("approveEvents reverted twice");
    await page.reload();
    await search.fill(`#${eventId}`);
    await expect(row.first()).toBeVisible({ timeout: 30_000 });
  }
  await confirmed(lastTx("approveEvents"));
  await shot(page, `${tag}-06-event-approved`);
}

/** Two attendees check in per run; a reused campaign needs room for both at 0.01 QIE each. Tops up from the UI. */
async function topUpIfLow(page: Page, tag: string, campaignId: string, journey: string) {
  const detail = (await (await fetch(`${BASE_URL}/api/campaigns/${campaignId}`)).json()) as { balance: string };
  if (BigInt(detail.balance) >= parseEther("0.02")) return;
  await page.goto(`${BASE_URL}/sponsor/${campaignId}`);
  await page.locator("#topup").fill("0.02");
  const sent = walletLog.txs.length;
  await page.getByRole("button", { name: "Top up", exact: true }).click();
  await expect(page.getByText("Added to the escrow")).toBeVisible({ timeout: 90_000 });
  expect(walletLog.txs.length).toBe(sent + 1);
  await confirmed(lastTx("topUp"));
  note(
    journey,
    `${tag}: campaign ${campaignId} held ${formatEther(BigInt(detail.balance))} QIE, topped up 0.02 QIE from the page: ${lastTx("topUp")}`,
  );
  await shot(page, `${tag}-05-topped-up`);
}

/**
 * Waits until the campaign page lists the settlement for this exact check-in: the attendee comes from the check-in
 * receipt, and a payout link only counts when its transaction settled that attendee.
 */
async function settlementOnCampaign(page: Page, tag: string, campaignId: string, checkInTx: Hex): Promise<Hex> {
  const checkIn = await confirmed(checkInTx);
  const checkedIn = parseEventLogs({ abi: registryAbi, eventName: "CheckedIn", logs: checkIn.logs })[0];
  if (!checkedIn) throw new Error(`${checkInTx} has no CheckedIn log`);
  const attendee = getAddress(checkedIn.args.attendee);
  const t0 = Date.now();
  const payouts = page.locator("section").filter({ has: page.getByRole("heading", { name: "Payouts", exact: true }) });
  // The payouts table is hidden on phones and the list on desktop; both are in the DOM, so take the visible one.
  const links = payouts.locator(`a[href*="${EXPLORER.replace("https://", "")}/tx/"]:visible`);
  let found: Hex | null = null;
  await expect
    .poll(
      async () => {
        await page.goto(`${BASE_URL}/sponsor/${campaignId}`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        if (
          !(await links
            .first()
            .waitFor({ state: "visible", timeout: 10_000 })
            .then(
              () => true,
              () => false,
            ))
        )
          return false;
        const hrefs = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
        for (const href of hrefs.slice(0, 5)) {
          const hash = /\/tx\/(0x[0-9a-fA-F]{64})/.exec(href)?.[1] as Hex | undefined;
          if (!hash) continue;
          const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
          const settled = receipt ? parseEventLogs({ abi: vaultAbi, eventName: "Settled", logs: receipt.logs }) : [];
          if (settled.some((l) => getAddress(l.args.attendee) === attendee && l.args.campaignId === BigInt(campaignId))) {
            found = hash;
            return true;
          }
        }
        return false;
      },
      { timeout: 150_000, intervals: [4000] },
    )
    .toBe(true);
  if (!found) throw new Error("unreachable: poll passed without a settlement");
  const hash: Hex = found;
  run.timings.push({ label: `${tag}: stamp shown to this attendee's settlement listed on the campaign page`, ms: Date.now() - t0 });
  run.relayed.push({ label: `${tag}: settlement (settleBatch) for attendee ${attendee} shown on campaign ${campaignId}`, hash });
  await payouts.scrollIntoViewIfNeeded();
  await shot(page, `${tag}-07-campaign-settlement`);
  return hash;
}

async function openReport(context: BrowserContext, tag: string, campaignId: string, journey: string) {
  const page = await context.newPage();
  watch(page, `${tag} report`);
  await page.goto(`${BASE_URL}/sponsor/${campaignId}/report`);
  await expect(page.locator(`a[href*="/tx/"]:visible`).first()).toBeVisible({ timeout: 45_000 });
  await shot(page, `${tag}-08-report`, true);
  note(journey, `${tag}: printable report /sponsor/${campaignId}/report rendered with explorer links`);
  await page.close();
}

/** Every hash the app or relayer exposes as an explorer link on the page. */
async function txLinksOn(page: Page): Promise<Hex[]> {
  const hrefs = await page.locator('a[href*="/tx/0x"]:visible').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  return [...new Set(hrefs.map((h) => /\/tx\/(0x[0-9a-fA-F]{64})/.exec(h)?.[1]).filter((h): h is string => !!h))] as Hex[];
}

// ------------------------------------------------------------------------------------------ journeys

test("journey 1 (390x844): organizer signs in, creates an event, authorizes the door, QR decodes", async ({ browser }) => {
  const j = "1-organizer-phone";
  run.balances.walletStart = formatEther(await publicClient.getBalance({ address: walletAddress }));
  operatorPhone = await newContext(browser, PHONE, true);
  const page = await operatorPhone.newPage();
  watch(page, "phone operator");
  await signInOrganizer(page, "j1-phone");
  if (RESUME_PHONE) {
    eventPhone = RESUME_PHONE.eventId;
    run.events.push({ viewport: "390x844", eventId: eventPhone, name: RESUME_PHONE.eventName });
    note(j, `reusing event ${eventPhone} created by an earlier run of this harness (LIVE_RESUME_PHONE)`);
  } else {
    const name = `Harness night ${new Date().toISOString().slice(5, 16).replace("T", " ")}`;
    eventPhone = await createEvent(page, "j1-phone", name);
    run.events.push({ viewport: "390x844", eventId: eventPhone, name });
    note(j, `event ${eventPhone} created: ${lastTx("createEvent")}`);
  }
  doorPhone = await openDoor(operatorPhone, "j1-phone", eventPhone, j);
  note(j, `door key authorized: ${lastTx("authorizeDoorKey")}`);
  run.journeys[j].status = "passed";
  save();
});

test("journey 2 (390x844): wallet-less attendee checks in, door count increments", async ({ browser }) => {
  const j = "2-attendee-phone";
  const { ms } = await attendeeCheckIn(browser, doorPhone, "j2-phone");
  note(j, `checked in to event ${eventPhone} in ${ms} ms; door count incremented`);
  run.journeys[j].status = "passed";
  save();
});

test("journey 3 (390x844): sponsor funds a campaign, approves the event, a check-in settles", async ({ browser }) => {
  const j = "3-sponsor-phone";
  const page = await operatorPhone.newPage();
  watch(page, "phone sponsor");
  await signInSponsor(page, "j3-phone");
  if (RESUME_PHONE) {
    campaignPhone = RESUME_PHONE.campaignId;
    run.campaigns.push({ viewport: "390x844", campaignId: campaignPhone });
    note(j, `reusing campaign ${campaignPhone}, already funded and approved for event ${eventPhone} by an earlier run (LIVE_RESUME_PHONE)`);
    await topUpIfLow(page, "j3-phone", campaignPhone, j);
  } else {
    campaignPhone = await createCampaign(page, "j3-phone", "Harness campaign, phone");
    run.campaigns.push({ viewport: "390x844", campaignId: campaignPhone });
    note(j, `campaign ${campaignPhone} created with 0.05 QIE: ${walletLog.txs[walletLog.txs.length - 1].hash}`);
    await approveEvent(page, "j3-phone", campaignPhone, eventPhone, eventName("390x844"));
    note(j, `event ${eventPhone} approved: ${lastTx("approveEvents")}`);
  }
  await doorPhone.bringToFront();
  const attendee = await attendeeCheckIn(browser, doorPhone, "j3-phone");
  paidAttendee = attendee.context;
  note(j, `second attendee checked in in ${attendee.ms} ms (${attendee.checkInTx})`);
  const settled = await settlementOnCampaign(page, "j3-phone", campaignPhone, attendee.checkInTx);
  note(j, `settlement on campaign page: ${settled}`);
  await openReport(operatorPhone, "j3-phone", campaignPhone, j);
  run.journeys[j].status = "passed";
  save();
});

test("journey 4 (390x844): attendee links the test wallet and withdraws to it", async () => {
  const j = "4-link-withdraw-phone";
  if (!paidAttendee) throw new Error("journey 3 did not leave a paid attendee");
  // Links are one-to-one and permanent. Once the test wallet is linked to a pass, a fresh gasless key stands in: the
  // link and the withdrawal are both relayed, so it needs no QIE.
  const existing = (await (await fetch(`${BASE_URL}/api/passport/${walletAddress}`)).json()) as { pass: string | null };
  const attendeeWallet = existing.pass ? privateKeyToAccount(generatePrivateKey()) : null;
  const receiver = attendeeWallet?.address ?? walletAddress;
  if (attendeeWallet) note(j, `test wallet is already linked to pass ${existing.pass}; using a fresh gasless wallet ${receiver} for this link`);
  await injectWallet(paidAttendee, attendeeWallet ?? undefined);
  const page = await paidAttendee.newPage();
  watch(page, "phone attendee wallet");
  await page.goto(`${BASE_URL}/pass`);
  await expect(page.getByText(/claimable|withdraw/i).first()).toBeVisible({ timeout: 45_000 });
  await shot(page, "j4-phone-01-passport");

  await page.goto(`${BASE_URL}/pass/link`);
  const connect = page.getByRole("button", { name: "Connect QIE Wallet" });
  const linkButton = page.getByRole("button", { name: "Link this wallet" });
  await expect(connect.or(linkButton)).toBeVisible({ timeout: 45_000 });
  if (await connect.isVisible()) await connect.click();
  await expect(linkButton).toBeEnabled({ timeout: 45_000 });
  await shot(page, "j4-phone-02-link-ready");
  const t0 = Date.now();
  await linkButton.click();
  await expect(page.getByText("QIE Wallet is linked")).toBeVisible({ timeout: 120_000 });
  run.timings.push({ label: 'j4-phone: link click to "QIE Wallet is linked"', ms: Date.now() - t0 });
  const linkTx = (await txLinksOn(page))[0];
  if (!linkTx) throw new Error("no explorer link for the link transaction");
  await confirmed(linkTx);
  run.relayed.push({ label: "j4-phone: linkWallet (relayed)", hash: linkTx });
  note(j, `wallet linked: ${linkTx}`);
  await shot(page, "j4-phone-03-linked");

  const before = await publicClient.getBalance({ address: receiver });
  run.balances.beforeAttendeeWithdraw = `${receiver} ${formatEther(before)}`;
  const withdraw = page.getByRole("button", { name: /^Withdraw (QIE|everything)$/ });
  const needsLink = page.getByRole("heading", { name: "Link QIE Wallet before you withdraw." });
  // The withdraw page reads the link from the index once. Right after linking it can still say "link first" and it
  // does not refresh on its own, so this reloads like a person would and records how long the index took.
  const t2 = Date.now();
  let staleLoads = 0;
  await expect
    .poll(
      async () => {
        await page.goto(`${BASE_URL}/pass/withdraw`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await expect(withdraw.or(needsLink)).toBeVisible({ timeout: 20_000 });
        if (await withdraw.isVisible()) return true;
        staleLoads++;
        if (staleLoads === 1) await shot(page, "j4-phone-04a-withdraw-says-link-first");
        return false;
      },
      { timeout: 180_000, intervals: [3000] },
    )
    .toBe(true);
  run.timings.push({ label: "j4-phone: link confirmed to withdraw page recognising the link (reloads)", ms: Date.now() - t2 });
  if (staleLoads > 0)
    note("bugs", `j4-phone: /pass/withdraw said "Link QIE Wallet before you withdraw." on ${staleLoads} load(s) after the link was confirmed`);
  await shot(page, "j4-phone-04-withdraw-ready");
  const t1 = Date.now();
  await withdraw.click();
  await expect(page.getByText("Withdrawn to your wallet").first()).toBeVisible({ timeout: 120_000 });
  run.timings.push({ label: 'j4-phone: withdraw click to "Withdrawn to your wallet"', ms: Date.now() - t1 });
  const withdrawTx = (await txLinksOn(page))[0];
  if (!withdrawTx) throw new Error("no explorer link for the withdrawal");
  await confirmed(withdrawTx);
  run.relayed.push({ label: "j4-phone: attendee withdrawal (relayed)", hash: withdrawTx });
  const after = await publicClient.getBalance({ address: receiver });
  run.balances.afterAttendeeWithdraw = `${receiver} ${formatEther(after)}`;
  // The relayer pays gas, so the wallet gains exactly the attendee's claimable share.
  expect(after).toBeGreaterThan(before);
  note(j, `withdrawal ${withdrawTx}: wallet ${formatEther(before)} -> ${formatEther(after)} QIE (+${formatEther(after - before)})`);
  await shot(page, "j4-phone-05-withdrawn");
  run.journeys[j].status = "passed";
  save();
});

test("journey 1 (1440x900): organizer signs in, creates an event, authorizes the door, QR decodes", async ({ browser }) => {
  const j = "1-organizer-desktop";
  operatorDesktop = await newContext(browser, DESKTOP, true);
  const page = await operatorDesktop.newPage();
  watch(page, "desktop operator");
  await signInOrganizer(page, "j1-desktop");
  if (RESUME_DESKTOP) {
    eventDesktop = RESUME_DESKTOP.eventId;
    run.events.push({ viewport: "1440x900", eventId: eventDesktop, name: RESUME_DESKTOP.eventName });
    note(j, `reusing event ${eventDesktop} created by an earlier run of this harness (LIVE_RESUME_DESKTOP)`);
  } else {
    const name = `Harness desk ${new Date().toISOString().slice(5, 16).replace("T", " ")}`;
    eventDesktop = await createEvent(page, "j1-desktop", name);
    run.events.push({ viewport: "1440x900", eventId: eventDesktop, name });
    note(j, `event ${eventDesktop} created: ${lastTx("createEvent")}`);
  }
  doorDesktop = await openDoor(operatorDesktop, "j1-desktop", eventDesktop, j);
  note(j, `door key authorized: ${lastTx("authorizeDoorKey")}`);
  run.journeys[j].status = "passed";
  save();
});

test("journey 3 (1440x900): sponsor funds a campaign, approves the event, a check-in settles", async ({ browser }) => {
  const j = "3-sponsor-desktop";
  const page = await operatorDesktop.newPage();
  watch(page, "desktop sponsor");
  await signInSponsor(page, "j3-desktop");
  if (RESUME_DESKTOP) {
    campaignDesktop = RESUME_DESKTOP.campaignId;
    note(j, `reusing campaign ${campaignDesktop} created by an earlier run (LIVE_RESUME_DESKTOP)`);
  } else {
    campaignDesktop = await createCampaign(page, "j3-desktop", "Harness campaign, desktop");
    note(j, `campaign ${campaignDesktop} created with 0.05 QIE: ${walletLog.txs[walletLog.txs.length - 1].hash}`);
  }
  run.campaigns.push({ viewport: "1440x900", campaignId: campaignDesktop });
  const detail = (await (await fetch(`${BASE_URL}/api/campaigns/${campaignDesktop}`)).json()) as { events: { id: string; approved: boolean }[] };
  if (detail.events.some((e) => e.id === eventDesktop && e.approved)) {
    note(j, `event ${eventDesktop} already approved for campaign ${campaignDesktop}`);
  } else {
    await approveEvent(page, "j3-desktop", campaignDesktop, eventDesktop, eventName("1440x900"));
    note(j, `event ${eventDesktop} approved: ${lastTx("approveEvents")}`);
  }
  await doorDesktop.bringToFront();
  const attendee = await attendeeCheckIn(browser, doorDesktop, "j3-desktop");
  note(j, `attendee checked in in ${attendee.ms} ms`);
  const settled = await settlementOnCampaign(page, "j3-desktop", campaignDesktop, attendee.checkInTx);
  note(j, `settlement on campaign page: ${settled}`);
  await openReport(operatorDesktop, "j3-desktop", campaignDesktop, j);
  run.journeys[j].status = "passed";
  save();
});

test("journey 5: organizer withdraws their share from /organize", async () => {
  const j = "5-organizer-withdraw";
  const operators = [
    ["j5-phone", operatorPhone],
    ["j5-desktop", operatorDesktop],
  ] as const;
  // Undefined when a run is filtered to one viewport with --grep.
  for (const [tag, context] of operators.filter(([, c]) => c !== undefined)) {
    const page = await context.newPage();
    watch(page, `${tag} organizer`);
    await page.goto(`${BASE_URL}/organize`);
    await expect(page.getByRole("heading", { name: "Payouts waiting for you" })).toBeVisible({ timeout: 45_000 });
    const withdraw = page.getByRole("button", { name: "Withdraw", exact: true });
    const offered = await withdraw
      .first()
      .isVisible({ timeout: 20_000 })
      .catch(() => false);
    await shot(page, `${tag}-01-payouts`);
    if (!offered) {
      note(j, `${tag}: no Withdraw button offered (nothing claimable)`);
      await page.close();
      continue;
    }
    const before = await publicClient.getBalance({ address: walletAddress });
    const t0 = Date.now();
    await withdraw.first().click();
    const sentOk = page.getByText("Withdrawal sent to your wallet");
    const rejected = page.getByText("The network rejected this withdrawal.");
    await expect(sentOk.or(rejected)).toBeVisible({ timeout: 120_000 });
    if (await rejected.isVisible()) {
      await shot(page, `${tag}-02-withdraw-rejected`);
      const claimable = await publicClient.readContract({
        address: deployment.vault,
        abi: [
          {
            type: "function",
            name: "claimable",
            stateMutability: "view",
            inputs: [{ type: "address" }, { type: "address" }],
            outputs: [{ type: "uint256" }],
          },
        ],
        functionName: "claimable",
        args: ["0x0000000000000000000000000000000000000000", walletAddress],
      });
      note(
        "bugs",
        `${tag}: /organize Withdraw (gasless relay) was rejected with 422 withdraw_rejected while ${formatEther(claimable)} QIE is claimable`,
      );
      throw new Error("organizer withdrawal was rejected by the relayer");
    }
    run.timings.push({ label: `${tag}: organizer withdraw click to success`, ms: Date.now() - t0 });
    const hash = (await txLinksOn(page))[0];
    if (!hash) throw new Error("no explorer link for the organizer withdrawal");
    await confirmed(hash);
    const after = await publicClient.getBalance({ address: walletAddress });
    const sentByWallet = walletLog.txs.some((t) => t.hash === hash);
    if (!sentByWallet) run.relayed.push({ label: `${tag}: organizer withdrawal (relayed)`, hash });
    note(
      j,
      `${tag}: organizer withdrawal ${hash}: wallet ${formatEther(before)} -> ${formatEther(after)} QIE${sentByWallet ? " (sent from the wallet, gas included)" : " (relayed)"}`,
    );
    await shot(page, `${tag}-02-withdrawn`);
    await page.close();
  }
  run.journeys[j].status = "passed";
  save();
});
