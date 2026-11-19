import type { CampaignDetail } from "@/lib/api/types";
import { explorerTx } from "@/lib/chain/chains";

const COLUMNS = ["campaign_id", "event_id", "event_name", "attendee", "organizer", "token", "gross", "to_attendee", "to_organizer", "fee", "settled_at", "tx", "explorer_url"] as const;

/** Quotes a CSV field and defuses spreadsheet formulas (a leading = + - @ tab or return), since event names are user input. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function campaignCsv(campaign: CampaignDetail): string {
  const rows = campaign.settlements.map((s) =>
    [s.campaignId, s.eventId, s.eventName, s.attendee, s.organizer, campaign.tokenSymbol, s.gross, s.toAttendee, s.toOrganizer, s.fee, s.at, s.tx, explorerTx(s.tx)].map(csvField).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
