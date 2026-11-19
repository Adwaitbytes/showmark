// Status codes returned by checkInBatch and settleBatch, and emitted in CheckInRejected and SettlementSkipped.
// The index of each name is its on-chain uint8 value (docs/INTERFACES.md sections 2.3 and 2.5).

export const CHECK_IN_STATUS = [
  "Recorded",
  "AlreadyPresent",
  "UnknownEvent",
  "BadAttendeeSig",
  "BadDoorSig",
  "DoorKeyNotAuthorized",
  "Stale",
  "OutsideEventWindow",
  "AtCapacity",
  "BadMode",
  "Paused",
] as const;

export type CheckInStatus = (typeof CHECK_IN_STATUS)[number];

export const SETTLE_STATUS = [
  "Settled",
  "AlreadySettled",
  "UnknownCampaign",
  "NotPresent",
  "OutsideCampaignWindow",
  "EventNotEligible",
  "EventCapReached",
  "TotalCapReached",
  "NeedsQieId",
  "PriceStale",
  "InsufficientBudget",
  "SettlementClosed",
  "Paused",
] as const;

export type SettleStatus = (typeof SETTLE_STATUS)[number];

/** Name for an on-chain check-in status code, or null for a code this SDK version does not know. */
export function checkInStatusName(code: number): CheckInStatus | null {
  return CHECK_IN_STATUS[code] ?? null;
}

/** Name for an on-chain settlement status code, or null for a code this SDK version does not know. */
export function settleStatusName(code: number): SettleStatus | null {
  return SETTLE_STATUS[code] ?? null;
}

export const PROOF_MODE = { rotating: 1, doorScansYou: 2 } as const;
export type ProofMode = (typeof PROOF_MODE)[keyof typeof PROOF_MODE];
