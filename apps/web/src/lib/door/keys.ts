import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { getAddress, isAddress, isAddressEqual, isHex, type Address, type Hex } from "viem";

// A door key is a throwaway key that lives only in the door device's browser. The organizer's wallet authorizes it
// on-chain for one event (authorizeDoorKey), and from then on it signs DoorPass and DoorAttest without any popup.
//
// Stored in localStorage on purpose. It is read synchronously on every rotation, it is 32 bytes, and IndexedDB would
// give no extra protection: both are readable by any script on this origin. What limits the damage of a leaked key
// is on-chain: it only works for one event, only inside that event's check-in window, and the organizer can revoke it.

const STORAGE_PREFIX = "showmark.door.v1";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One key per chain, registry and event, so a device that runs two events never mixes them up. */
export interface DoorKeyScope {
  chainId: number;
  registry: Address;
  eventId: bigint;
}

export interface StoredDoorKey {
  version: 1;
  privateKey: Hex;
  address: Address;
  createdAt: string;
  /** Set once this device has seen the key authorized on-chain, so a later zero reads as "revoked", not "new". */
  authorizedAt: string | null;
}

export class DoorStorageUnavailableError extends Error {
  constructor() {
    super("This browser does not allow saving a door key. Open the door screen in a normal browser window, not a private one.");
    this.name = "DoorStorageUnavailableError";
  }
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    // Safari private mode and some embedded browsers throw on access.
    return null;
  }
}

export function doorKeyStorageKey(scope: DoorKeyScope): string {
  return `${STORAGE_PREFIX}:${scope.chainId}:${scope.registry.toLowerCase()}:${scope.eventId.toString()}`;
}

function parse(raw: string | null): StoredDoorKey | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const v = value as Partial<StoredDoorKey>;
    if (v.version !== 1 || typeof v.privateKey !== "string" || !isHex(v.privateKey) || v.privateKey.length !== 66) return null;
    if (typeof v.address !== "string" || !isAddress(v.address)) return null;
    // A record whose address does not match its key was tampered with or corrupted; treat it as absent.
    if (!isAddressEqual(privateKeyToAccount(v.privateKey).address, v.address)) return null;
    return {
      version: 1,
      privateKey: v.privateKey,
      address: getAddress(v.address),
      createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
      authorizedAt: typeof v.authorizedAt === "string" ? v.authorizedAt : null,
    };
  } catch {
    return null;
  }
}

export function readDoorKey(storage: KeyValueStorage | null, scope: DoorKeyScope): StoredDoorKey | null {
  return parse(storage?.getItem(doorKeyStorageKey(scope)) ?? null);
}

export function loadDoorAccount(storage: KeyValueStorage | null, scope: DoorKeyScope): PrivateKeyAccount | null {
  const stored = readDoorKey(storage, scope);
  return stored ? privateKeyToAccount(stored.privateKey) : null;
}

/** Returns the saved door key for this event, or creates and saves a new one. */
export function ensureDoorKey(
  storage: KeyValueStorage | null,
  scope: DoorKeyScope,
  generate: () => Hex = generatePrivateKey,
  now: () => Date = () => new Date(),
): StoredDoorKey {
  if (!storage) throw new DoorStorageUnavailableError();
  const existing = readDoorKey(storage, scope);
  if (existing) return existing;
  const privateKey = generate();
  const record: StoredDoorKey = {
    version: 1,
    privateKey,
    address: privateKeyToAccount(privateKey).address,
    createdAt: now().toISOString(),
    authorizedAt: null,
  };
  storage.setItem(doorKeyStorageKey(scope), JSON.stringify(record));
  return record;
}

/** Remembers that the chain accepted this key, so a later zero validUntil can be explained as a revocation. */
export function markDoorKeyAuthorized(storage: KeyValueStorage | null, scope: DoorKeyScope, now: () => Date = () => new Date()): void {
  const existing = readDoorKey(storage, scope);
  if (!storage || !existing || existing.authorizedAt) return;
  storage.setItem(doorKeyStorageKey(scope), JSON.stringify({ ...existing, authorizedAt: now().toISOString() }));
}

/** "This device is not the door anymore": the key is gone from this browser for good. */
export function forgetDoorKey(storage: KeyValueStorage | null, scope: DoorKeyScope): void {
  storage?.removeItem(doorKeyStorageKey(scope));
}
