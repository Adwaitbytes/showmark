import { describe, expect, it, vi } from "vitest";
import { getAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkInTypes, doorAttestTypes, doorPassTypes, registryDomain } from "@/lib/chain/eip712";
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
import { isRetryableStatus, submitAttestation, submitAttestationBatch, type FetchLike } from "./relay";
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

  it("signs a DoorPass that recovers to the door key under the registry domain", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const recovered = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { eventId: 12n, issuedAt: 1_764_245_000n },
      signature: pass.doorSig,
    });
    expect(recovered).toBe(doorKey.address);
  });

  it("does not recover to the door key under another registry or event", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const otherContract = await recoverTypedDataAddress({
      domain: registryDomain(OTHER_REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { eventId: 12n, issuedAt: 1_764_245_000n },
      signature: pass.doorSig,
    });
    const otherEvent = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { eventId: 13n, issuedAt: 1_764_245_000n },
      signature: pass.doorSig,
    });
    expect(otherContract).not.toBe(doorKey.address);
    expect(otherEvent).not.toBe(doorKey.address);
  });

  it("round-trips the door pass through the QR url", async () => {
    const pass = await signDoorPass(doorKey, 12n, 1_764_245_000n, REGISTRY);
    const url = doorPassUrl("https://showmark.app/", pass);
    expect(url.startsWith("https://showmark.app/c/12.1764245000.")).toBe(true);
    expect(decodeDoorPass(url)).toEqual(pass);
  });

  it("signs a DoorAttest bound to the scanned attendee", async () => {
    const attendee = privateKeyToAccount(generatePrivateKey());
    const attendeeSig = await attendee.signTypedData({
      domain: registryDomain(REGISTRY),
      types: checkInTypes,
      primaryType: "CheckIn",
      message: { eventId: 12n, attendee: attendee.address },
    });
    const code = decodeAttendeeCode(encodeAttendeeCode({ eventId: 12n, attendee: attendee.address, attendeeSig }));
    expect(code).not.toBeNull();
    if (!code) return;

    const signed = await signDoorAttest(doorKey, code, 1_764_245_100n, REGISTRY);
    expect(signed).toMatchObject({ eventId: "12", attendee: attendee.address, mode: 2, doorTime: "1764245100", attendeeSig });

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
  return { eventId, attendee, mode: 2, doorTime: "1764245100", attendeeSig: `0x${"11".repeat(65)}`, doorSig: `0x${"22".repeat(65)}` };
}

describe("offline queue", () => {
  it("stores a scan once and reports a repeat scan as a duplicate", async () => {
    const queue = new DoorQueue(new MemoryQueueStore());
    expect(await queue.enqueue(attestation(1))).toBe("added");
    expect(await queue.enqueue(attestation(1))).toBe("duplicate");
    expect(await queue.summary("12")).toEqual({ pending: 1, sent: 0, rejected: 0 });
  });

  it("flushes in batches of at most 50 and marks them sent", async () => {
    const batches: number[] = [];
    const submitters: Submitters = {
      batch: vi.fn(async (items) => {
        batches.push(items.length);
        return { kind: "ok" as const, value: { txHash: TX, accepted: items.length } };
      }),
      single: vi.fn(),
    };
    const queue = new DoorQueue(new MemoryQueueStore(), submitters);
    for (let i = 1; i <= 120; i++) await queue.enqueue(attestation(i));
    await queue.enqueue(attestation(500, "13"));

    const result = await queue.flush("12");
    expect(batches).toEqual([50, 50, 20]);
    expect(result).toEqual({ sent: 120, rejected: 0, remaining: 0, stoppedBy: null });
    expect(await queue.summary("12")).toEqual({ pending: 0, sent: 120, rejected: 0 });
    expect(await queue.summary("13")).toEqual({ pending: 1, sent: 0, rejected: 0 });
    expect(submitters.single).not.toHaveBeenCalled();
  });

  it("keeps everything when the relayer is unreachable and stops trying", async () => {
    const offline = { code: "offline", message: "No connection.", action: "Wait." };
    const batch = vi.fn(async () => ({ kind: "retry" as const, error: offline }));
    const queue = new DoorQueue(new MemoryQueueStore(), { batch, single: vi.fn() });
    for (let i = 1; i <= 60; i++) await queue.enqueue(attestation(i));

    const result = await queue.flush("12");
    expect(batch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ sent: 0, remaining: 60, stoppedBy: offline });
    const records = await queue.list("12");
    expect(records.every((r) => r.state === "pending")).toBe(true);
    expect(records.filter((r) => r.attempts === 1)).toHaveLength(50);
  });

  it("isolates a bad item when the relayer refuses a whole batch", async () => {
    const bad = attestation(2);
    const submitters: Submitters = {
      batch: async () => ({ kind: "rejected", status: 400, error: { code: "invalid_request", message: "Bad.", action: "Fix." } }),
      single: async (item) => {
        if (item.attendee === bad.attendee) return { kind: "rejected", status: 422, error: { code: "bad_attendee_sig", message: "Bad sig.", action: "Rescan." } };
        if (item.attendee === attestation(3).attendee) return { kind: "rejected", status: 422, error: { code: "already_present", message: "Already.", action: "None." } };
        return { kind: "ok", value: { txHash: TX } };
      },
    };
    const queue = new DoorQueue(new MemoryQueueStore(), submitters);
    for (const i of [1, 2, 3]) await queue.enqueue(attestation(i));

    const result = await queue.flush("12");
    expect(result).toEqual({ sent: 2, rejected: 1, remaining: 0, stoppedBy: null });
    const byId = new Map((await queue.list("12")).map((r) => [r.id, r]));
    expect(byId.get(attestationId(bad))?.state).toBe("rejected");
    expect(byId.get(attestationId(bad))?.error?.code).toBe("bad_attendee_sig");
    expect(byId.get(attestationId(attestation(3)))).toMatchObject({ state: "sent", txHash: null });
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
      return { kind: "ok" as const, value: { txHash: TX, accepted: items.length } };
    });
    const queue = new DoorQueue(new MemoryQueueStore(), { batch, single: vi.fn() });
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

  it("returns the transaction hash on success", async () => {
    expect(await submitAttestation(item, respond(200, { txHash: TX, status: "submitted" }))).toEqual({ kind: "ok", value: { txHash: TX } });
    expect(await submitAttestationBatch([item], respond(200, { txHash: TX, accepted: 1 }))).toEqual({
      kind: "ok",
      value: { txHash: TX, accepted: 1 },
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
