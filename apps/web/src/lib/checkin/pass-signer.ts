import type { DoorPassPayload } from "@/lib/qr/payload";
import { ensurePass, PassUnavailableError } from "@/lib/wallet/pass";
import { signCheckIn, type CheckInRequest } from "./sign";

export type SignResult = { ok: true; request: CheckInRequest } | { ok: false; reason: "storage" | "sign" };

/**
 * Creates the pass if this phone has none, then signs the check-in. Its own module so the door
 * route can start downloading the signing code (secp256k1 and EIP-712, about 45 kB gzipped) in
 * parallel with the first paint instead of in front of it.
 */
export async function passAndSign(door: DoorPassPayload): Promise<SignResult> {
  try {
    return { ok: true, request: await signCheckIn(ensurePass(), door) };
  } catch (error) {
    return { ok: false, reason: error instanceof PassUnavailableError ? "storage" : "sign" };
  }
}
