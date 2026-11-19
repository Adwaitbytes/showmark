import type { DoorPassPayload } from "@/lib/qr/payload";
import { ensurePassKey, PassStorageError } from "./pass-key";
import { signCheckIn, type CheckInRequest } from "./sign";

export type SignResult = { ok: true; request: CheckInRequest } | { ok: false; reason: "storage" | "sign" };

/**
 * Creates the pass if this phone has none, then signs the check-in and the ticket. Its own module so
 * the door route downloads the signing code (secp256k1 and EIP-712) alongside the first paint
 * instead of in front of it.
 */
export async function passAndSign(door: DoorPassPayload): Promise<SignResult> {
  try {
    return { ok: true, request: await signCheckIn(ensurePassKey(), door) };
  } catch (error) {
    return { ok: false, reason: error instanceof PassStorageError ? "storage" : "sign" };
  }
}
