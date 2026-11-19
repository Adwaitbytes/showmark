import type { EventDetail } from "@/lib/api/types";
import { formatDate } from "@/ui/format";
import { stampDataUri } from "@/ui/stamp/stampSvg";

/** ERC-1155 metadata (EIP-1155 "Metadata JSON Schema") for one PresenceStamp token. Token id = event id. */
export interface StampMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number; display_type?: "number" | "date" }[];
}

/**
 * Parses the token id from the URI. The contract appends the decimal id, but ERC-1155 clients may also
 * substitute {id} as 64 lowercase hex characters, so both are accepted. Null for anything else.
 */
export function parseTokenId(raw: string): string | null {
  if (/^[1-9]\d{0,76}$/.test(raw)) return raw;
  if (/^[0-9a-f]{64}$/.test(raw)) {
    const value = BigInt(`0x${raw}`);
    return value > BigInt(0) ? value.toString() : null;
  }
  return null;
}

export function stampMetadata(event: EventDetail, siteUrl: string): StampMetadata {
  const { name, venue, city } = event.metadata;
  const place = [venue, city].filter(Boolean).join(", ");
  const attributes: StampMetadata["attributes"] = [
    { trait_type: "Event", value: name },
    { trait_type: "City", value: city },
    { trait_type: "Date", value: Math.floor(Date.parse(event.startsAt) / 1000), display_type: "date" },
    { trait_type: "Organizer", value: event.organizerName ?? event.organizer },
    { trait_type: "Checked in", value: event.checkedIn, display_type: "number" },
  ];
  if (event.seriesId !== "0") attributes.push({ trait_type: "Series position", value: event.seriesIndex, display_type: "number" });

  return {
    name: `Showmark stamp: ${name}`,
    description: `Proof of presence at ${name}${place ? `, ${place}` : ""}, on ${formatDate(event.startsAt)}. Recorded by the Showmark registry on QIE when the holder checked in at the door. It cannot be transferred.`,
    image: stampDataUri({ eventId: event.id, eventName: name, city, at: event.startsAt, mode: 1, serial: event.id }),
    external_url: `${siteUrl}/e/${event.id}`,
    attributes,
  };
}
