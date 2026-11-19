import "server-only";

import { addresses, isDeployed } from "@/lib/chain/addresses";
import { publicClient } from "@/lib/chain/clients";
import { vaultAbi } from "@/lib/chain/generated-abi";
import type { EventDetail } from "@/lib/api/types";
import { judgesDeskEventId } from "@/lib/copy/site";
import { getEvent } from "@/server/queries";
import { withTimeout } from "@/server/timeout";
import { load } from "../_components/load";

/** The judges' desk event, or null when it is not configured or cannot be read right now. */
export async function deskEvent(): Promise<EventDetail | null> {
  const id = judgesDeskEventId();
  if (!id || !isDeployed()) return null;
  const result = await load(() => getEvent(id));
  return result.ok ? result.data : null;
}

/** The vault's protocol fee for new campaigns, read live. Null when the chain cannot be read. */
export async function protocolFeeBps(): Promise<number | null> {
  if (!isDeployed()) return null;
  try {
    const bps = await withTimeout(
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "feeBps" }),
      "vault.feeBps",
    );
    return Number(bps);
  } catch {
    // The slide shows a visible placeholder instead of a guessed number.
    return null;
  }
}
