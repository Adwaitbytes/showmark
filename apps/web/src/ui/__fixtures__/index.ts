import type { EventDetail, Passport, Traction } from "@/lib/api/types";

/**
 * Typed sample data for the /dev/ui gallery and component tests only. Production pages must
 * never import this file; they read the chain through @/server/queries and show a designed
 * empty state when there is nothing yet.
 */

export const SAMPLE_PASS = "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b" as const;
export const SAMPLE_WALLET = "0x2F9d41aE7b3C5e8D1a6F0b4C9e2D7a5B3c1E8f06" as const;
export const SAMPLE_ORGANIZER = "0x91C4e2B7a3D5f8E1c6A9b0D4e7F2a5C8b1D3e6F9" as const;
export const SAMPLE_TX = "0x5c1f9e2d7b3a8c4e6f0d1b9a2c7e5f3d8b4a6c0e9f1d2b7a3c5e8f4d6b0a9c1e" as const;

export const sampleEvent: EventDetail = {
  id: "12",
  organizer: SAMPLE_ORGANIZER,
  organizerName: "campusweb3.qie",
  startsAt: "2026-11-27T12:30:00.000Z",
  endsAt: "2026-11-27T15:30:00.000Z",
  capacity: 180,
  checkedIn: 64,
  maxPassAge: 60,
  seriesId: "3",
  seriesIndex: 4,
  metadata: {
    v: 1,
    name: "Sample builders meetup",
    venue: "Sample hall, second floor",
    city: "Bengaluru",
    description: "A sample event used to preview the design system. It does not exist on chain.",
  },
  createdTx: SAMPLE_TX,
  campaigns: [
    {
      id: "4",
      name: "Sample campaign",
      sponsorName: "Sample sponsor",
      token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
      tokenSymbol: "QUSDC",
      attendeeAmount: "1200000",
      requireQieId: true,
      minProofMode: 1,
    },
  ],
  recentCheckIns: [
    { attendee: SAMPLE_PASS, name: "asha.qie", at: "2026-11-27T12:41:00.000Z", tx: SAMPLE_TX, mode: 1 },
    { attendee: SAMPLE_WALLET, name: null, at: "2026-11-27T12:39:00.000Z", tx: SAMPLE_TX, mode: 2 },
  ],
};

const stampCities = ["Bengaluru", "Pune", "Chennai", "Hyderabad", "Delhi", "Mumbai", "Kochi"] as const;
const stampNames = [
  "Sample builders meetup",
  "Sample campus session",
  "Sample community call",
  "Sample design night",
  "Sample hack day",
  "Sample founders breakfast",
  "Sample city walk",
] as const;

export const samplePassport: Passport = {
  pass: SAMPLE_PASS,
  wallet: SAMPLE_WALLET,
  qieName: "asha.qie",
  holdsQieId: true,
  stamps: stampNames.map((eventName, i) => ({
    eventId: String(4 + i * 3),
    eventName,
    city: stampCities[i] ?? "Bengaluru",
    at: new Date(Date.UTC(2026, 10, 6 + i * 4, 13, 10)).toISOString(),
    mode: i % 3 === 1 ? 2 : 1,
    tx: SAMPLE_TX,
    streak: i < 4 ? i + 1 : 1,
  })),
  streaks: [{ seriesId: "3", seriesName: "Sample builders meetup", current: 4, best: 4 }],
  claimable: [{ token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", symbol: "QUSDC", amount: "4800000" }],
  pending: [],
};

export const emptyPassport: Passport = {
  pass: SAMPLE_PASS,
  wallet: null,
  qieName: null,
  holdsQieId: false,
  stamps: [],
  streaks: [],
  claimable: [],
  pending: [],
};

export const sampleTraction: Traction = {
  updatedAt: "2026-11-28T10:00:00.000Z",
  verifiedAttendees: 312,
  eventsWithCheckIns: 7,
  organizers: 4,
  sponsors: { teamFunded: 1, external: 2 },
  settled: [
    {
      token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
      symbol: "QUSDC",
      teamFunded: "180000000",
      external: "240000000",
    },
    { token: "0x0000000000000000000000000000000000000000", symbol: "QIE", teamFunded: "0", external: "1250000000000000000000" },
  ],
  settledUsd: { teamFunded: 180, external: 251.4, price: 0.0091, priceUpdatedAt: "2026-11-28T09:12:00.000Z" },
  newWalletsViaShowmark: 171,
  passesLinked: 168,
  conversionRate: 168 / 312,
  attendeesWithQieId: 140,
  repeatAttendees: 58,
  showmarkTransactions: 1642,
  chainDailyTransactions: 1700,
  shareOfChainDaily: 0.21,
  daily: Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 15 + i)).toISOString().slice(0, 10);
    const checkIns = [0, 0, 6, 0, 0, 41, 0, 12, 0, 66, 0, 88, 54, 45][i] ?? 0;
    return { date, checkIns, settlements: Math.round(checkIns * 0.86) };
  }),
};

export const emptyTraction: Traction = {
  ...sampleTraction,
  verifiedAttendees: 0,
  eventsWithCheckIns: 0,
  organizers: 0,
  sponsors: { teamFunded: 0, external: 0 },
  settled: [],
  settledUsd: { teamFunded: 0, external: 0, price: 0.0091, priceUpdatedAt: "2026-11-28T09:12:00.000Z" },
  newWalletsViaShowmark: 0,
  passesLinked: 0,
  conversionRate: 0,
  attendeesWithQieId: 0,
  repeatAttendees: 0,
  showmarkTransactions: 0,
  daily: [],
};
