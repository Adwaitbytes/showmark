import { encodeAbiParameters, keccak256 } from "viem";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { CheckInData } from "../schemas";

/** Stable id for one door attestation, so a door device resending its offline queue never creates duplicates. */
export function doorQueueId(d: CheckInData): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint8" }, { type: "uint64" }],
      [d.eventId, d.attendee, d.mode, d.doorTime],
    ),
  );
}

/** Records what a door device submitted, before relaying, so an operator can see and resend anything stuck. */
export async function recordDoorQueue(db: Db, items: CheckInData[], receivedAt: Date): Promise<void> {
  if (items.length === 0) return;
  await db
    .insert(t.doorQueue)
    .values(
      items.map((d) => ({
        id: doorQueueId(d),
        eventId: d.eventId,
        payload: { ...d, eventId: d.eventId.toString(), doorTime: d.doorTime.toString() },
        receivedAt,
      })),
    )
    .onConflictDoNothing();
}
