import { describe, expect, it, vi } from "vitest";
import { getAddress, recoverTypedDataAddress, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkInTypes, doorAttestTypes, doorPassTypes, registryDomain, ticketTypes } from "@/lib/chain/eip712";
import { activeChainId } from "@/lib/chain/chains";
import { decodeAttendeeCode, decodeDoorPass, doorPassUrl, encodeAttendeeCode } from "@/lib/qr/payload";
import { ChainClock, describeSkew } from "./clock";
import {
  doorKeyStorageKey,
  ensureDoorKey,
  forgetDoorKey,
  loadDoorAccount,
  markDoorKeyAuthorized,
  readDoorKey,
  type DoorKeyScope,
  type KeyValueStorage,
} from "./keys";
import { DoorQueue, MemoryQueueStore, attestationId, type Submitters } from "./queue";
import { isRetryableStatus, pollAttestation, submitAttestation, submitAttestationBatch, type BatchAnswer, type FetchLike } from "./relay";
import {
  checkInWindow,
  doorKeyValidUntil,
  issuedAtFor,
  msUntilNextRotation,
  ROTATION_MS,
  rotationStart,
  secondsLeft,
} from "./rotation";
import { signDoorAttest, signDoorPass, type SignedAttestation } from "./sign";

const REGISTRY: Address = getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const OTHER_REGISTRY: Address = getAddress("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
const TX: Hex = `0x${"ab".repeat(32)}`;

class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const scope = (eventId: bigint, registry: Address = REGISTRY): DoorKeyScope => ({ chainId: activeChainId, registry, eventId });

describe("door keys", () => {
  it("creates a key once per event and reloads the same key", () => {
    const storage = new MemoryStorage();
    const first = ensureDoorKey(storage, scope(7n));
    const again = ensureDoorKey(storage, scope(7n));
    expect(again.privateKey).toBe(first.privateKey);
    expect(loadDoorAccount(storage, scope(7n))?.address).toBe(first.address);
    expect(first.authorizedAt).toBeNull();
  });

  it("keeps keys for different events and registries apart", () => {
    const storage = new MemoryStorage();
    const a = ensureDoorKey(storage, scope(1n));
    const b = ensureDoorKey(storage, scope(2n));
    const c = ensureDoorKey(storage, scope(1n, OTHER_REGISTRY));
    expect(new Set([a.address, b.address, c.address]).size).toBe(3);
    expect(doorKeyStorageKey(scope(1n))).not.toBe(doorKeyStorageKey(scope(1n, OTHER_REGISTRY)));
  });

  it("treats a record whose address does not match its key as absent", () => {
    const storage = new MemoryStorage();
    const real = ensureDoorKey(storage, scope(3n));
    storage.setItem(doorKeyStorageKey(scope(3n)), JSON.stringify({ ...real, address: privateKeyToAccount(generatePrivateKey()).address }));
    expect(readDoorKey(storage, scope(3n))).toBeNull();
    storage.setItem(doorKeyStorageKey(scope(3n)), "not json");
    expect(readDoorKey(storage, scope(3n))).toBeNull();
  });

  it("remembers authorization and forgets the key on reset", () => {
    const storage = new MemoryStorage();
    ensureDoorKey(storage, scope(4n));
    markDoorKeyAuthorized(storage, scope(4n), () => new Date("2026-11-27T12:00:00Z"));
    expect(readDoorKey(storage, scope(4n))?.authorizedAt).toBe("2026-11-27T12:00:00.000Z");
    forgetDoorKey(storage, scope(4n));
    expect(readDoorKey(storage, scope(4n))).toBeNull();
  });

  it("refuses to create a key without storage", () => {
    expect(() => ensureDoorKey(null, scope(1n))).toThrow(/door key/);
  });
});

describe("door signatures", () => {
  const doorKey = privateKeyToAccount(generatePrivateKey());

  const ticketOf = (pass: { ticketKey: Hex }) => privateKeyToAccount(pass.ticketKey).address;

  it("signs a DoorPass over a fresh ticket that recovers to the door key under the registry domain", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const recovered = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { eventId: 12n, issuedAt: 1_764_245_000n, ticket: ticketOf(pass) },
      signature: pass.doorSig,
    });
    expect(recovered).toBe(doorKey.address);
  });

  it("uses a new ticket key for every rotation", async () => {
    const a = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const b = await signDoorPass(doorKey, 12n, 1_764_245_015n, REGISTRY);
    expect(a.ticketKey).not.toBe(b.ticketKey);
    expect(ticketOf(a)).not.toBe(doorKey.address);
  });

  it("lets whoever holds the ticket key sign a Ticket for their own address", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const attendee = privateKeyToAccount(generatePrivateKey()).address;
    const ticketSig = await privateKeyToAccount(pass.ticketKey).signTypedData({
      domain: registryDomain(REGISTRY),
      types: ticketTypes,
      primaryType: "Ticket",
      message: { eventId: 12n, attendee },
    });
    const signer = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: ticketTypes,
      primaryType: "Ticket",
      message: { eventId: 12n, attendee },
      signature: ticketSig,
    });
    expect(signer).toBe(ticketOf(pass));
  });

  it("does not recover to the door key under another registry, event or ticket", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const message = { eventId: 12n, issuedAt: 1_764_245_000n, ticket: ticketOf(pass) };
    const otherContract = await recoverTypedDataAddress({
      domain: registryDomain(OTHER_REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message,
      signature: pass.doorSig,
    });
    const otherEvent = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { ...message, eventId: 13n },
      signature: pass.doorSig,
    });
    const otherTicket = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { ...message, ticket: privateKeyToAccount(generatePrivateKey()).address },
      signature: pass.doorSig,
    });
    expect(otherContract).not.toBe(doorKey.address);
    expect(otherEvent).not.toBe(doorKey.address);
    expect(otherTicket).not.toBe(doorKey.address);
  });

  it("round-trips the door pass through the QR url", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const url = doorPassUrl("https://showmark.app/", pass);
    // The ticket key rides in the fragment, which browsers never send to a server (audit N-03).
    const [path, fragment] = url.split("#");
    expect(path).toMatch(/^https:\/\/showmark\.app\/c\/12\.1764245000\.[A-Za-z0-9_-]{87}$/);
    expect(fragment).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(decodeDoorPass(url)).toEqual(pass);
  });

  it("signs a DoorAttest bound to the scanned attendee", async () => {
    const attendee = privateKeyToAccount(generatePrivateKey());
    const attendeeSig = await attendee.signTypedData({
      domain: registryDomain(REGISTRY),
      types: checkInTypes,
      primaryType: "CheckIn",
      message: { eventId: 12n, attendee: attendee.address, mode: 2 },
    });
    const code = decodeAttendeeCode(encodeAttendeeCode({ eventId: 12n, attendee: attendee.address, attendeeSig }));
    expect(code).not.toBeNull();
    if (!code) return;

    const signed = await signDoorAttest(doorKey, code, 1_764_245_100n, REGISTRY);
    expect(signed).toMatchObject({ eventId: "12", attendee: attendee.address, mode: 2, doorTime: "1764245100", attendeeSig, ticket: zeroAddress, ticketSig: "0x" });

    const recovered = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorAttestTypes,
      primaryType: "DoorAttest",
      message: { eventId: 12n, attendee: attendee.address, attestedAt: 1_764_245_100n },
      signature: signed.doorSig,
    });
    expect(recovered).toBe(doorKey.address);

    const someoneElse = privateKeyToAccount(generatePrivateKey()).address;
    const notBound = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorAttestTypes,
      primaryType: "DoorAttest",
      message: { eventId: 12n, attendee: someoneElse, attestedAt: 1_764_245_100n },
      signature: signed.doorSig,
    });
    expect(notBound).not.toBe(doorKey.address);
  });
});

describe("rotation timing", () => {
  it("rotates every 15 seconds on chain-time boundaries", () => {
    expect(ROTATION_MS).toBe(15_000);
    const boundary = 1_764_245_010_000; // a multiple of 15 000
    expect(rotationStart(boundary + 2_500)).toBe(boundary);
    expect(msUntilNextRotation(boundary)).toBe(15_000);
    expect(msUntilNextRotation(boundary + 14_999)).toBe(1);
    expect(secondsLeft(boundary)).toBe(15);
    expect(secondsLeft(boundary + 14_100)).toBe(1);
  });

  it("never issues a pass in the future", () => {
    expect(issuedAtFor(1_764_245_007_999)).toBe(1_764_245_007n);
  });

  it("opens check-in an hour before the start and closes an hour after the end", () => {
    const startsAt = 10_000n;
    const endsAt = 20_000n;
    expect(checkInWindow(startsAt - 3601n, startsAt, endsAt)).toBe("before");
    expect(checkInWindow(startsAt - 3600n, startsAt, endsAt)).toBe("open");
    expect(checkInWindow(endsAt + 3600n, startsAt, endsAt)).toBe("open");
    expect(checkInWindow(endsAt + 3601n, startsAt, endsAt)).toBe("closed");
  });

  it("authorizes door keys only as long as door times can be accepted", () => {
    expect(doorKeyValidUntil(20_000n)).toBe(23_600n);
    expect(doorKeyValidUntil(20_000n) <= 20_000n + 3n * 86_400n).toBe(true);
  });
});

describe("chain clock", () => {
  it("uses the device clock until the first block arrives", () => {
    const clock = new ChainClock(() => 1_000_000);
    expect(clock.synced).toBe(false);
    expect(clock.nowMs()).toBe(1_000_000);
  });

  it("corrects a slow device clock with block time", () => {
    let device = 1_764_245_000_000 - 60_000; // device runs a minute slow
    const clock = new ChainClock(() => device);
    clock.record({ blockTimestamp: 1_764_245_000n, receivedAtMs: device });
    expect(clock.offsetMs).toBe(60_000);
    expect(clock.isSkewed()).toBe(true);
    device += 5_000;
    expect(clock.nowSeconds()).toBe(1_764_245_005n);
  });

  it("keeps the freshest block of the recent samples", () => {
    const clock = new ChainClock(() => 0);
    clock.record({ blockTimestamp: 100n, receivedAtMs: 103_000 }); // block was 3 s old
    clock.record({ blockTimestamp: 104n, receivedAtMs: 104_500 }); // 0.5 s old
    expect(clock.offsetMs).toBe(-500);
    expect(clock.isSkewed()).toBe(false);
  });

  it("describes skew in words", () => {
    expect(describeSkew(-45_000)).toBe("45 seconds");
    expect(describeSkew(300_000)).toBe("5 minutes");
    expect(describeSkew(4 * 3_600_000)).toBe("4 hours");
  });
});

function attestation(n: number, eventId = "12"): SignedAttestation {
  const attendee = getAddress(`0x${n.toString(16).padStart(40, "0")}`);
  return {
    eventId,
    attendee,
    mode: 2,
    doorTime: "1764245100",
    ticket: zeroAddress,
    attendeeSig: `0x${"11".repeat(65)}`,
    doorSig: `0x${"22".repeat(65)}`,
    ticketSig: "0x",
  };
}

const okBatch = (items: readonly SignedAttestation[], rejected: BatchAnswer["rejected"] = []) => ({
  kind: "ok" as const,
  value: { txHash: TX, accepted: items.length - rejected.length, rejected },
});
const noCall = () => {
  throw new Error("not expected");
};

function submitters(patch: Partial<Submitters>): Submitters {
  return { batch: vi.fn(noCall), single: vi.fn(noCall), poll: vi.fn(noCall), ...patch };
}

describe("offline queue", () => {
  it("stores a scan once and reports a repeat scan as a duplicate", async () => {
    const queue = new DoorQueue(new MemoryQueueStore());
    expect(await queue.enqueue(attestation(1))).toBe("added");
    expect(await queue.enqueue(attestation(1))).toBe("duplicate");
    expect(await queue.summary("12")).toEqual({ pending: 1, confirming: 0, sent: 0, rejected: 0 });
  });

  it("flushes in batches of at most 50 and marks them sent", async () => {
    const sizes: number[] = [];
    const batch = vi.fn(async (items: readonly SignedAttestation[]) => {
      sizes.push(items.length);
      return okBatch(items);
    });
    const subs = submitters({ batch });
    const queue = new DoorQueue(new MemoryQueueStore(), subs);
    for (let i = 1; i <= 120; i++) await queue.enqueue(attestation(i));
    await queue.enqueue(attestation(500, "13"));

    const result = await queue.flush("12");
    expect(sizes).toEqual([50, 50, 20]);
    expect(result).toEqual({ sent: 120, rejected: 0, remaining: 0, stoppedBy: null });
    expect(await queue.summary("12")).toEqual({ pending: 0, confirming: 0, sent: 120, rejected: 0 });
    expect(await queue.summary("13")).toEqual({ pending: 1, confirming: 0, sent: 0, rejected: 0 });
    expect(subs.single).not.toHaveBeenCalled();
  });

  it("reads the per-item answers in a batch: already present is sent, a send failure stays pending, the rest are rejected", async () => {
    const batch = vi.fn(async (items: readonly SignedAttestation[]) =>
      okBatch(items, [
        { index: 1, code: "already_present", message: "Already.", action: "None." },
        { index: 2, code: "relay_send_failed", message: "Not sent.", action: "Again." },
        { index: 3, code: "bad_attendee_sig", message: "Bad sig.", action: "Rescan." },
      ]),
    );
    const queue = new DoorQueue(new MemoryQueueStore(), submitters({ batch }));
    for (const i of [1, 2, 3, 4]) await queue.enqueue(attestation(i));
    expect(await queue.flush("12")).toEqual({ sent: 2, rejected: 1, remaining: 1, stoppedBy: null });
    const byId = new Map((await queue.list("12")).map((r) => [r.id, r]));
    expect(byId.get(attestationId(attestation(1)))).toMatchObject({ state: "sent", txHash: TX });
    expect(byId.get(attestationId(attestation(2)))).toMatchObject({ state: "sent", txHash: null });
    expect(byId.get(attestationId(attestation(3)))).toMatchObject({ state: "pending", error: { code: "relay_send_failed" } });
    expect(byId.get(attestationId(attestation(4)))).toMatchObject({ state: "rejected", error: { code: "bad_attendee_sig" } });
  });

  it("keeps everything when the relayer is unreachable and stops trying", async () => {
    const offline = { code: "offline", message: "No connection.", action: "Wait." };
    const batch = vi.fn(async () => ({ kind: "retry" as const, error: offline }));
    const queue = new DoorQueue(new MemoryQueueStore(), submitters({ batch }));
    for (let i = 1; i <= 60; i++) await queue.enqueue(attestation(i));

    const result = await queue.flush("12");
    expect(batch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ sent: 0, remaining: 60, stoppedBy: offline });
    const records = await queue.list("12");
    expect(records.every((r) => r.state === "pending")).toBe(true);
    expect(records.filter((r) => r.attempts === 1)).toHaveLength(50);
  });

  it("isolates a bad item when the relayer refuses a whole batch, and treats a queued single as accepted", async () => {
    const bad = attestation(2);
    const subs = submitters({
      batch: async () => ({ kind: "rejected", status: 400, error: { code: "invalid_request", message: "Bad.", action: "Fix." } }),
      single: async (item) => {
        if (item.attendee === bad.attendee) return { kind: "rejected", status: 422, error: { code: "bad_attendee_sig", message: "Bad sig.", action: "Rescan." } };
        if (item.attendee === attestation(3).attendee) return { kind: "rejected", status: 422, error: { code: "already_present", message: "Already.", action: "None." } };
        if (item.attendee === attestation(4).attendee) return { kind: "ok", value: { sent: false, queuedId: "abcdef0123456789abcdef01" } };
        return { kind: "ok", value: { sent: true, txHash: TX } };
      },
    });
    const queue = new DoorQueue(new MemoryQueueStore(), subs);
    for (const i of [1, 2, 3, 4]) await queue.enqueue(attestation(i));

    const result = await queue.flush("12");
    expect(result).toEqual({ sent: 3, rejected: 1, remaining: 0, stoppedBy: null });
    const byId = new Map((await queue.list("12")).map((r) => [r.id, r]));
    expect(byId.get(attestationId(bad))?.state).toBe("rejected");
    expect(byId.get(attestationId(attestation(3)))).toMatchObject({ state: "sent", txHash: null });
    expect(byId.get(attestationId(attestation(4)))).toMatchObject({ state: "confirming", relayId: "abcdef0123456789abcdef01" });
  });

  it("confirms queued check-ins by polling, and never sends them to the offline queue while the relayer has them", async () => {
    let clock = 1_000_000;
    const answers = new Map<string, Awaited<ReturnType<Submitters["poll"]>>>([
      ["a".repeat(24), { kind: "ok", value: { sent: false, queuedId: "a".repeat(24) } }],
      ["b".repeat(24), { kind: "ok", value: { sent: true, txHash: TX } }],
      ["c".repeat(24), { kind: "rejected", status: 422, error: { code: "already_present", message: "Already.", action: "None." } }],
      ["d".repeat(24), { kind: "rejected", status: 422, error: { code: "at_capacity", message: "Full.", action: "Ask." } }],
      ["e".repeat(24), { kind: "retry", error: { code: "offline", message: "Down.", action: "Wait." } }],
    ]);
    const poll = vi.fn(async (id: string) => answers.get(id)!);
    const queue = new DoorQueue(new MemoryQueueStore(), submitters({ poll }), () => clock);
    const letters = ["a", "b", "c", "d", "e"];
    for (const [i, l] of letters.entries()) await queue.recordQueued(attestation(i + 1), l.repeat(24));
    expect(await queue.summary("12")).toEqual({ pending: 0, confirming: 5, sent: 0, rejected: 0 });

    expect(await queue.confirm("12")).toEqual({ confirmed: 2, rejected: 1, requeued: 0, stillConfirming: 2 });
    expect(await queue.summary("12")).toEqual({ pending: 0, confirming: 2, sent: 2, rejected: 1 });

    // After the relayer's results would have expired, anything still unconfirmed goes back to pending to be resent.
    clock += 10 * 60_000;
    expect(await queue.confirm("12")).toEqual({ confirmed: 0, rejected: 0, requeued: 2, stillConfirming: 0 });
    expect(await queue.summary("12")).toEqual({ pending: 2, confirming: 0, sent: 2, rejected: 1 });
  });

  it("lets a rejected code be scanned again", async () => {
    const store = new MemoryQueueStore();
    const queue = new DoorQueue(store);
    const item = attestation(9);
    await store.put({ id: attestationId(item), eventId: "12", item, state: "rejected", queuedAt: 0, attempts: 1, txHash: null, error: null });
    expect(await queue.enqueue(item)).toBe("added");
  });

  it("shares one run between concurrent flushes", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const batch = vi.fn(async (items: readonly SignedAttestation[]) => {
      await gate;
      return okBatch(items);
    });
    const queue = new DoorQueue(new MemoryQueueStore(), submitters({ batch }));
    await queue.enqueue(attestation(1));
    const a = queue.flush("12");
    const b = queue.flush("12");
    release();
    expect(await a).toEqual(await b);
    expect(batch).toHaveBeenCalledTimes(1);
  });
});

function respond(status: number, body: unknown): FetchLike {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("relay client", () => {
  const item = attestation(1);

  it("returns the transaction hash once broadcast", async () => {
    expect(await submitAttestation(item, respond(200, { txHash: TX, status: "submitted" }))).toEqual({ kind: "ok", value: { sent: true, txHash: TX } });
    expect(await submitAttestationBatch([item], respond(200, { txHash: TX, accepted: 1, rejected: [] }))).toEqual({
      kind: "ok",
      value: { txHash: TX, accepted: 1, rejected: [] },
    });
  });

  it("treats 202 queued as accepted, with the id to poll", async () => {
    const id = "0123456789abcdef01234567";
    expect(await submitAttestation(item, respond(202, { status: "queued", id }))).toEqual({ kind: "ok", value: { sent: false, queuedId: id } });
    expect(await pollAttestation(id, respond(202, { status: "queued", id }))).toEqual({ kind: "ok", value: { sent: false, queuedId: id } });
    expect(await pollAttestation(id, respond(200, { txHash: TX, status: "submitted" }))).toEqual({ kind: "ok", value: { sent: true, txHash: TX } });
  });

  it("reads a batch where nothing needed sending", async () => {
    const rejected = [{ index: 0, code: "already_present", message: "Already.", action: "None." }];
    expect(await submitAttestationBatch([item], respond(200, { txHash: null, accepted: 0, rejected }))).toEqual({
      kind: "ok",
      value: { txHash: null, accepted: 0, rejected },
    });
  });

  it("passes the relayer's own words through on a rejection", async () => {
    const error = { code: "already_present", message: "You are already checked in to this event.", action: "Open your passport." };
    expect(await submitAttestation(item, respond(422, { error }))).toEqual({ kind: "rejected", status: 422, error });
  });

  it("asks to retry when the network or server is down", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await submitAttestation(item, down)).kind).toBe("retry");
    expect((await submitAttestation(item, respond(503, {}))).kind).toBe("retry");
    expect((await submitAttestation(item, respond(429, {}))).kind).toBe("retry");
    expect(isRetryableStatus(400)).toBe(false);
  });

  it("refuses an empty or oversized batch before sending", () => {
    expect(() => submitAttestationBatch([], respond(200, {}))).toThrow(RangeError);
    expect(() => submitAttestationBatch(Array.from({ length: 51 }, (_, i) => attestation(i + 1)), respond(200, {}))).toThrow(RangeError);
  });
});
