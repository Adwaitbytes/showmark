import { isHex, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import type { StoredPass } from "@/lib/wallet/pass";
import { browserStorage, type KeyValueStorage } from "./storage";

// The pass key without a viem account object. Same storage key and record format as
// src/lib/wallet/pass.ts (StoredPass, "showmark.pass.v1"), so a pass made here loads with loadPass
// and vice versa; pass-key.test.ts proves the round trip. pass.ts imports privateKeyToAccount, whose
// account object pulls transaction serializers into the door route, which only needs the raw key.

const STORAGE_KEY = "showmark.pass.v1";

/** Thrown when the browser will not keep a pass, with the same meaning as PassUnavailableError. */
export class PassStorageError extends Error {
  constructor() {
    super("This browser does not allow saving a pass.");
    this.name = "PassStorageError";
  }
}

function readKey(storage: KeyValueStorage): Hex | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const v = value as Partial<StoredPass>;
    if (v.version !== 1 || typeof v.privateKey !== "string" || !isHex(v.privateKey) || v.privateKey.length !== 66) return null;
    if (v.origin !== "random" && v.origin !== "wallet-derived") return null;
    return v.privateKey;
  } catch {
    return null;
  }
}

/** The private key of this phone's pass, creating and saving a random one the first time. */
export function ensurePassKey(storage: KeyValueStorage | null = browserStorage()): Hex {
  if (!storage) throw new PassStorageError();
  const existing = readKey(storage);
  if (existing) return existing;
  const record: StoredPass = { version: 1, privateKey: generatePrivateKey(), createdAt: new Date().toISOString(), origin: "random" };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    throw new PassStorageError();
  }
  // Read back so a store that silently drops writes is caught before a check-in is signed with a lost key.
  const saved = readKey(storage);
  if (saved !== record.privateKey) throw new PassStorageError();
  return saved;
}
