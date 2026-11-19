import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { isHex, keccak256, toBytes, type Hex } from "viem";

// The pass is a local key that signs check-ins without any wallet popup, which keeps scan-to-stamp fast.
// It never holds funds: rewards stay in the vault until the pass is linked to a real wallet.
// Stored in localStorage on purpose: losing a pass only loses the ability to sign new check-ins,
// and stamps already recorded stay on-chain at the pass address.

const STORAGE_KEY = "showmark.pass.v1";

export interface StoredPass {
  version: 1;
  privateKey: Hex;
  createdAt: string;
  origin: "random" | "wallet-derived";
}

export interface PassStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): PassStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    // Safari private mode and some embedded browsers throw on access.
    return null;
  }
}

function parseStored(raw: string | null): StoredPass | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const v = value as Partial<StoredPass>;
    if (v.version !== 1 || typeof v.privateKey !== "string" || !isHex(v.privateKey) || v.privateKey.length !== 66) return null;
    if (v.origin !== "random" && v.origin !== "wallet-derived") return null;
    return { version: 1, privateKey: v.privateKey, createdAt: String(v.createdAt ?? ""), origin: v.origin };
  } catch {
    return null;
  }
}

export class PassUnavailableError extends Error {
  constructor() {
    super("This browser does not allow saving a pass. Open Showmark in your normal browser, not a private window.");
    this.name = "PassUnavailableError";
  }
}

export function loadPass(storage: PassStorage | null = browserStorage()): PrivateKeyAccount | null {
  const stored = parseStored(storage?.getItem(STORAGE_KEY) ?? null);
  return stored ? privateKeyToAccount(stored.privateKey) : null;
}

export function loadStoredPass(storage: PassStorage | null = browserStorage()): StoredPass | null {
  return parseStored(storage?.getItem(STORAGE_KEY) ?? null);
}

/** Returns the existing pass, or creates and saves a new random one. */
export function ensurePass(storage: PassStorage | null = browserStorage()): PrivateKeyAccount {
  if (!storage) throw new PassUnavailableError();
  const existing = loadPass(storage);
  if (existing) return existing;
  return savePass(generatePrivateKey(), "random", storage);
}

export function savePass(privateKey: Hex, origin: StoredPass["origin"], storage: PassStorage | null = browserStorage()): PrivateKeyAccount {
  if (!storage) throw new PassUnavailableError();
  const record: StoredPass = { version: 1, privateKey, createdAt: new Date().toISOString(), origin };
  storage.setItem(STORAGE_KEY, JSON.stringify(record));
  return privateKeyToAccount(privateKey);
}

export function forgetPass(storage: PassStorage | null = browserStorage()): void {
  storage?.removeItem(STORAGE_KEY);
}

/** The message a wallet signs to derive its recoverable pass. Changing it changes every derived pass. */
export function passDerivationMessage(wallet: string): string {
  return [
    "Showmark pass",
    "",
    "Signing this creates your Showmark pass on this device. It does not move any funds and costs nothing.",
    "",
    `Wallet: ${wallet.toLowerCase()}`,
    "Version: 1",
  ].join("\n");
}

/**
 * Derives a pass key from a wallet signature so a wallet owner can recreate the same pass on any device.
 * Only safe when the wallet produces deterministic signatures; callers must sign twice and compare first.
 */
export function derivePassKey(signature: Hex): Hex {
  if (!isHex(signature) || toBytes(signature).length !== 65) throw new Error("Expected a 65 byte signature");
  return keccak256(toBytes(`showmark.pass.v1:${signature}`));
}
