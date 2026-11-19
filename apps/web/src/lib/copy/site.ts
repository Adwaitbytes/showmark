/**
 * Shared site copy and links. Copy rules (docs/INTERFACES.md section 7): plain words, sentence
 * case, specific numbers, no dashes used as punctuation, no emoji, no exclamation marks.
 */

export const SITE = {
  name: "Showmark",
  pitch: "Sponsors pay only for people who actually show up.",
  description:
    "Showmark holds a sponsor's budget in escrow on QIE and pays out per verified person at the door. Attendees check in with their phone and get a stamp in their passport.",
  repoUrl: "https://github.com/Adwaitbytes/showmark",
  sdkReadmeUrl: "https://github.com/Adwaitbytes/showmark/tree/main/packages/sdk#readme",
  hackathon: "QIE Hackathon 3.0",
} as const;

export type NavKey = "home" | "how" | "traction" | "docs" | "sponsor" | "organize" | "passport" | "event" | "none";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
}

/** Reading the product. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { key: "how", href: "/#how-it-works", label: "How it works" },
  { key: "traction", href: "/traction", label: "Traction" },
  { key: "docs", href: "/docs", label: "Docs" },
];

/** Using the product, by role. Routes are owned by the attendee, organizer and sponsor apps. */
export const ROLE_NAV: readonly NavItem[] = [
  { key: "sponsor", href: "/sponsor", label: "Sponsor" },
  { key: "organize", href: "/organize", label: "Organize" },
];

export const PASSPORT_NAV: NavItem = { key: "passport", href: "/me", label: "My passport" };

/** Event id of the permanent judges' desk on the active chain, set once it exists. */
export function judgesDeskEventId(): string | null {
  const raw = process.env.NEXT_PUBLIC_JUDGES_DESK_EVENT_ID;
  return raw && /^\d+$/.test(raw) ? raw : null;
}
