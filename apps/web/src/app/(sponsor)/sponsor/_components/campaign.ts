import type { CampaignSummary } from "@/lib/api/types";
import { formatTokenAmount, formatUsd, type TokenSymbol } from "@/ui/format";
import type { StatusTone } from "@/ui/StatusMark";

export function statusMark(status: CampaignSummary["status"]): { tone: StatusTone; label: string } {
  switch (status) {
    case "scheduled":
      return { tone: "scheduled", label: "Scheduled" };
    case "live":
      return { tone: "live", label: "Live" };
    case "ended":
      return { tone: "ended", label: "Ended" };
    case "refundable":
      return { tone: "attention", label: "Refund open" };
    case "refunded":
      return { tone: "ended", label: "Refunded" };
  }
}

/** "2 QUSDC per person" or "$1.50 per person, paid in QIE". */
export function perPresenceText(c: Pick<CampaignSummary, "pricing" | "amountPerPresence" | "tokenSymbol">): string {
  if (c.pricing === 1) return `${formatUsd(Number(c.amountPerPresence) / 1e6)} per person, paid in QIE`;
  return `${formatTokenAmount(c.amountPerPresence, c.tokenSymbol)} ${c.tokenSymbol} per person`;
}

export function amountText(value: string | bigint, symbol: TokenSymbol): string {
  return `${formatTokenAmount(value.toString(), symbol)} ${symbol}`;
}

export const PROOF_MODE_COPY = {
  1: {
    title: "Rotating door code",
    short: "Mode 1",
    body:
      "The door screen shows a code that changes every 15 seconds, and the chain rejects codes older than the event allows, so a photo from yesterday is useless. Someone at the venue could still stream the screen to a friend outside within that window.",
  },
  2: {
    title: "Door scans you",
    short: "Mode 2",
    body:
      "Door staff scan each attendee's own code and the door signs an attestation bound to that one person. Nobody outside the room can get one. It needs staff with a phone or laptop at the door, and it works offline.",
  },
} as const;
