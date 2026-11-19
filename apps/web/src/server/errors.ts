import type { ApiError } from "@/lib/api/types";
import { CHECK_IN_STATUS, SETTLE_STATUS } from "@/lib/chain/abi";

/** User-facing error copy. `message` says what happened, `action` says what to do next. */
export interface ErrorCopy {
  code: string;
  message: string;
  action: string;
}

/**
 * The one error type the server throws on purpose. Route handlers turn it into the `ApiError` shape with
 * `status`; server components can catch it and render `copy` directly.
 */
export class AppError extends Error {
  readonly status: number;
  readonly copy: ErrorCopy;
  /** Extra response headers, for example Retry-After on a 429. */
  readonly headers: Record<string, string>;

  constructor(status: number, copy: ErrorCopy, options?: { cause?: unknown; headers?: Record<string, string> }) {
    super(`${copy.code}: ${copy.message}`, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.copy = copy;
    this.headers = options?.headers ?? {};
  }

  toBody(): ApiError {
    return { error: { code: this.copy.code, message: this.copy.message, action: this.copy.action } };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export const COMMON_ERRORS = {
  databaseNotConfigured: {
    code: "database_not_configured",
    message: "Showmark cannot reach its database right now.",
    action: "Try again in a few minutes. If this keeps happening, tell the Showmark team.",
  },
  redisNotConfigured: {
    code: "redis_not_configured",
    message: "Showmark cannot reach its rate limit and queue service right now.",
    action: "Try again in a few minutes. If this keeps happening, tell the Showmark team.",
  },
  relayerNotConfigured: {
    code: "relayer_not_configured",
    message: "Gasless check-in is switched off on this server.",
    action: "Try again later, or ask the organizer to tell the Showmark team.",
  },
  notDeployed: {
    code: "not_deployed",
    message: "The Showmark contracts are not deployed on this network yet.",
    action: "Check back once the contracts are live.",
  },
  upstream: {
    code: "upstream_unavailable",
    message: "A service Showmark depends on did not answer in time.",
    action: "Try again in a few seconds.",
  },
  internal: {
    code: "internal_error",
    message: "Something went wrong on our side.",
    action: "Try again. If it happens again, tell the Showmark team what you were doing.",
  },
} as const satisfies Record<string, ErrorCopy>;

export type CheckInStatusName = (typeof CHECK_IN_STATUS)[number];
export type SettleStatusName = (typeof SETTLE_STATUS)[number];

const CHECK_IN_COPY: Record<Exclude<CheckInStatusName, "Recorded">, Omit<ErrorCopy, "code">> = {
  AlreadyPresent: {
    message: "You are already checked in to this event.",
    action: "Open your passport to see the stamp.",
  },
  UnknownEvent: {
    message: "This event does not exist on Showmark.",
    action: "Check that you scanned the code at the right door, or ask the organizer.",
  },
  BadAttendeeSig: {
    message: "Your pass could not sign this check-in.",
    action: "Reload the app and scan the door code again.",
  },
  BadDoorSig: {
    message: "The door code was not signed correctly.",
    action: "Scan the door code again. If it keeps failing, ask the organizer to restart the door screen.",
  },
  DoorKeyNotAuthorized: {
    message: "This door screen is not authorized for the event.",
    action: "Ask the organizer to authorize the door screen again, then scan the new code.",
  },
  Stale: {
    message: "The door code expired before it reached the network.",
    action: "Scan the code on the door screen again. It changes every 15 seconds.",
  },
  OutsideEventWindow: {
    message: "Check-in is closed for this event right now.",
    action: "Check-in opens one hour before the event starts and closes one hour after it ends.",
  },
  AtCapacity: {
    message: "This event is full.",
    action: "Ask the organizer whether more places can be opened.",
  },
  BadMode: {
    message: "This event does not accept this kind of check-in.",
    action: "Scan the code on the door screen, or ask a door volunteer to scan the code in your app.",
  },
  Paused: {
    message: "Showmark has paused check-ins for safety.",
    action: "Try again in a few minutes.",
  },
};

const SETTLE_COPY: Record<Exclude<SettleStatusName, "Settled">, Omit<ErrorCopy, "code">> = {
  AlreadySettled: {
    message: "This reward was already paid.",
    action: "Open your passport to see what you can withdraw.",
  },
  UnknownCampaign: {
    message: "This campaign does not exist.",
    action: "Check the campaign link, or ask the sponsor.",
  },
  NotPresent: {
    message: "This campaign found no check-in it accepts for this event.",
    action: "Some campaigns only pay when a door volunteer scans your code. Look for other campaigns on the event page.",
  },
  OutsideCampaignWindow: {
    message: "The check-in happened outside the dates this campaign pays for.",
    action: "Look for other campaigns on the event page.",
  },
  EventNotEligible: {
    message: "This campaign does not pay for this event.",
    action: "Look for other campaigns on the event page.",
  },
  EventCapReached: {
    message: "This campaign has already paid as many people as it allows for this event.",
    action: "Look for other campaigns on the event page.",
  },
  TotalCapReached: {
    message: "This campaign has already paid as many people as it allows in total.",
    action: "Look for other campaigns on the event page.",
  },
  NeedsQieId: {
    message: "This reward needs a QIE ID on a linked QIE Wallet.",
    action: "Link QIE Wallet to your pass and make sure the wallet holds a QIE ID. The payout is retried after that.",
  },
  PriceStale: {
    message: "The QIE price feed has not updated recently, so this reward is waiting.",
    action: "You do not need to do anything. The payout is retried once the price feed updates.",
  },
  InsufficientBudget: {
    message: "This campaign has run out of funds.",
    action: "The sponsor can top it up. Until then, look for other campaigns on the event page.",
  },
  SettlementClosed: {
    message: "The time to pay out this campaign has ended.",
    action: "Look for other campaigns on the event page.",
  },
  Paused: {
    message: "Showmark has paused payouts for safety.",
    action: "You do not need to do anything. Payouts resume when the pause ends.",
  },
};

function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Copy for a non-zero `checkInBatch` status code. Unknown codes fall back to a generic rejection. */
export function checkInStatusCopy(status: number): ErrorCopy {
  const name = CHECK_IN_STATUS[status];
  if (!name || name === "Recorded") {
    return { code: "check_in_rejected", message: "The network did not record this check-in.", action: "Scan the door code again." };
  }
  return { code: snake(name), ...CHECK_IN_COPY[name] };
}

/** Copy for a non-zero `settleBatch` status code. */
export function settleStatusCopy(status: number): ErrorCopy {
  const name = SETTLE_STATUS[status];
  if (!name || name === "Settled") {
    return { code: "settlement_rejected", message: "The network did not pay out this reward.", action: "Try again later." };
  }
  return { code: `settle_${snake(name)}`, ...SETTLE_COPY[name] };
}

export const RELAY_ERRORS = {
  rateLimitedIp: {
    code: "rate_limited",
    message: "Too many requests from this network in the last minute.",
    action: "Wait a minute and try again.",
  },
  rateLimitedPass: {
    code: "rate_limited_pass",
    message: "This pass sent too many check-ins in the last minute.",
    action: "Wait a minute and try again.",
  },
  invalidRequest: {
    code: "invalid_request",
    message: "The request was not in the format Showmark expects.",
    action: "Reload the app and try again.",
  },
  queueTimeout: {
    code: "relay_timeout",
    message: "The check-in is taking longer than usual to reach the network.",
    action: "Keep this screen open. If no stamp appears within a minute, scan the door code again.",
  },
  sendFailed: {
    code: "relay_send_failed",
    message: "The network did not accept the transaction.",
    action: "Try again in a few seconds.",
  },
  linkRejected: {
    code: "link_rejected",
    message: "The network rejected this wallet link.",
    action: "Sign again in QIE Wallet. Each pass links to one wallet, and each wallet to one pass.",
  },
  nothingToWithdraw: {
    code: "nothing_to_withdraw",
    message: "There is nothing to withdraw for this account in this token.",
    action: "Rewards appear here after a check-in is paid out.",
  },
  withdrawRejected: {
    code: "withdraw_rejected",
    message: "The network rejected this withdrawal.",
    action: "Try again in a few minutes. If it keeps failing, tell the Showmark team.",
  },
  bodyTooLarge: {
    code: "body_too_large",
    message: "The request was larger than Showmark accepts.",
    action: "Send fewer items at a time.",
  },
} as const satisfies Record<string, ErrorCopy>;

export const AUTH_ERRORS = {
  nonceInvalid: {
    code: "auth_nonce_invalid",
    message: "This sign-in request expired or was already used.",
    action: "Start sign in again.",
  },
  messageInvalid: {
    code: "auth_message_invalid",
    message: "The sign-in message was not in the format Showmark expects.",
    action: "Start sign in again from this page.",
  },
  domainMismatch: {
    code: "auth_domain_mismatch",
    message: "This sign-in message was made for a different site or network.",
    action: "Start sign in again from this page.",
  },
  signatureInvalid: {
    code: "auth_signature_invalid",
    message: "The signature does not match this wallet.",
    action: "Sign the message again with the same wallet.",
  },
  unauthorized: {
    code: "unauthorized",
    message: "You are not signed in, or your session ended.",
    action: "Sign in with QIE Wallet and try again.",
  },
} as const satisfies Record<string, ErrorCopy>;

export const READ_ERRORS = {
  notFound: {
    code: "not_found",
    message: "Showmark has no record of this.",
    action: "Check the link and try again.",
  },
  nameNotFound: {
    code: "name_not_found",
    message: "No QIE ID with this name exists.",
    action: "Check the spelling, or search by wallet address instead.",
  },
  invalidId: {
    code: "invalid_id",
    message: "This id is not a valid number.",
    action: "Check the link and try again.",
  },
  invalidAddress: {
    code: "invalid_address",
    message: "This is not a valid address or QIE ID name.",
    action: "Use a 0x address or a name that ends in .qie.",
  },
  invalidTxHash: {
    code: "invalid_tx_hash",
    message: "This is not a valid transaction hash.",
    action: "Check the link and try again.",
  },
  rateLimited: {
    code: "rate_limited",
    message: "Too many requests from this network in the last minute.",
    action: "Wait a minute and try again.",
  },
  cronUnauthorized: {
    code: "unauthorized",
    message: "This endpoint needs the cron secret.",
    action: "Send it as a Bearer token in the Authorization header.",
  },
} as const satisfies Record<string, ErrorCopy>;
