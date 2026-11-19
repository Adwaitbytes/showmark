/**
 * API-shaped fixtures for sponsor console tests and screenshots only. They never ship: the console reads real data
 * from /api and the chain.
 */
import { getAddress, keccak256, toHex, zeroAddress, type Address } from "viem";
import type { CampaignSummary, EventSummary } from "../../src/lib/api/types";
import type { SponsorCampaignDetail, SponsorSettlement } from "../../src/lib/sponsor/api";
import { ADDR, FEE_BPS, SPONSOR, type CampaignStruct } from "./harness";

const DAY = 86_400_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const hash = (s: string) => keccak256(toHex(s));
const addr = (n: number): Address => getAddress(`0x${(0xa11ce000 + n).toString(16).padStart(40, "0")}`);

const ORGANIZERS = [
  { address: getAddress("0x2b4bd92b4bd92b4bd92b4bd92b4bd92b4bd92b4b"), name: "pune.qie" },
  { address: getAddress("0x1f6b451f6b451f6b451f6b451f6b451f6b451f6b"), name: null },
];

export const EVENTS: EventSummary[] = [
  {
    id: "12",
    organizer: ORGANIZERS[0]!.address,
    organizerName: ORGANIZERS[0]!.name,
    startsAt: iso(now - 2 * DAY),
    endsAt: iso(now - 2 * DAY + 3 * 3_600_000),
    capacity: 120,
    checkedIn: 86,
    maxPassAge: 60,
    seriesId: "0",
    seriesIndex: 0,
    metadata: { v: 1, name: "Builders night 14", venue: "Third Wave Coffee, Baner", city: "Pune", description: "" },
    createdTx: hash("e12"),
  },
  {
    id: "15",
    organizer: ORGANIZERS[1]!.address,
    organizerName: null,
    startsAt: iso(now - DAY),
    endsAt: iso(now - DAY + 2 * 3_600_000),
    capacity: 0,
    checkedIn: 41,
    maxPassAge: 60,
    seriesId: "0",
    seriesIndex: 0,
    metadata: { v: 1, name: "Solidity study circle", venue: "COEP hostel common room", city: "Pune", description: "" },
    createdTx: hash("e15"),
  },
  {
    id: "18",
    organizer: ORGANIZERS[0]!.address,
    organizerName: ORGANIZERS[0]!.name,
    startsAt: iso(now + 3 * DAY),
    endsAt: iso(now + 3 * DAY + 3 * 3_600_000),
    capacity: 200,
    checkedIn: 0,
    maxPassAge: 60,
    seriesId: "0",
    seriesIndex: 0,
    metadata: { v: 1, name: "Builders night 15", venue: "Third Wave Coffee, Baner", city: "Pune", description: "" },
    createdTx: hash("e18"),
  },
  {
    id: "21",
    organizer: getAddress("0x9aab56e7727af53a3131985bfb16d845319b7bdc"),
    organizerName: "blrdao.qie",
    startsAt: iso(now + 6 * DAY),
    endsAt: iso(now + 6 * DAY + 4 * 3_600_000),
    capacity: 300,
    checkedIn: 0,
    maxPassAge: 45,
    seriesId: "0",
    seriesIndex: 0,
    metadata: { v: 1, name: "QIE builders meetup", venue: "Bangalore International Centre", city: "Bengaluru", description: "" },
    createdTx: hash("e21"),
  },
];

const AMOUNT = 2_000_000n; // 2 QUSDC
const split = (gross: bigint) => {
  const fee = (gross * BigInt(FEE_BPS)) / 10_000n;
  const toAttendee = ((gross - fee) * 6_000n) / 10_000n;
  return { fee, toAttendee, toOrganizer: gross - fee - toAttendee };
};

function settlements(): SponsorSettlement[] {
  const rows: SponsorSettlement[] = [];
  const e12 = Date.parse(EVENTS[0]!.startsAt) + 20 * 60_000;
  for (let i = 0; i < 34; i++) {
    // The first 31 land within one minute: enough to raise the burst soft signal.
    const at = i < 31 ? e12 + i * 1_500 : e12 + 40 * 60_000 + i * 60_000;
    const s = split(AMOUNT);
    rows.push({
      campaignId: "7",
      eventId: "12",
      eventName: EVENTS[0]!.metadata.name,
      attendee: addr(i),
      attendeeName: i % 5 === 0 ? `member${i}.qie` : null,
      organizer: ORGANIZERS[0]!.address,
      organizerName: ORGANIZERS[0]!.name,
      gross: AMOUNT.toString(),
      toAttendee: s.toAttendee.toString(),
      toOrganizer: s.toOrganizer.toString(),
      fee: s.fee.toString(),
      at: iso(at),
      tx: hash(`s12-${i}`),
    });
  }
  const e15 = Date.parse(EVENTS[1]!.startsAt) + 10 * 60_000;
  for (let i = 0; i < 8; i++) {
    const s = split(AMOUNT);
    rows.push({
      campaignId: "7",
      eventId: "15",
      eventName: EVENTS[1]!.metadata.name,
      attendee: addr(100 + i),
      attendeeName: null,
      organizer: ORGANIZERS[1]!.address,
      organizerName: null,
      gross: AMOUNT.toString(),
      toAttendee: s.toAttendee.toString(),
      toOrganizer: s.toOrganizer.toString(),
      fee: s.fee.toString(),
      at: iso(e15 + i * 4 * 60_000),
      tx: hash(`s15-${i}`),
    });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const SETTLED = settlements();
const FUNDED = 500_000_000n;
const SETTLED_AMOUNT = AMOUNT * BigInt(SETTLED.length);

export const CAMPAIGN_SUMMARY: CampaignSummary = {
  id: "7",
  sponsor: SPONSOR,
  sponsorName: "Acme Labs",
  name: "Pune builders nights",
  description: "Pays every verified attendee at Pune builder meetups this season, split 60 to 40 with the organizer.",
  token: ADDR.qusdc,
  tokenSymbol: "QUSDC",
  pricing: 0,
  amountPerPresence: AMOUNT.toString(),
  attendeeShareBps: 6_000,
  feeBps: FEE_BPS,
  minProofMode: 2,
  requireQieId: false,
  startsAt: iso(now - 5 * DAY),
  endsAt: iso(now + 20 * DAY),
  balance: (FUNDED - SETTLED_AMOUNT).toString(),
  funded: FUNDED.toString(),
  settledCount: SETTLED.length,
  settledAmount: SETTLED_AMOUNT.toString(),
  teamFunded: false,
  status: "live",
  maxPerEvent: 150,
  maxTotal: 0,
  openToBonded: false,
  minBond: "0",
  challengeDeadline: null,
};

export const CAMPAIGNS: CampaignSummary[] = [
  CAMPAIGN_SUMMARY,
  {
    ...CAMPAIGN_SUMMARY,
    id: "4",
    name: "Judges' desk",
    sponsorName: "Showmark",
    token: zeroAddress,
    tokenSymbol: "QIE",
    pricing: 1,
    amountPerPresence: "500000",
    attendeeShareBps: 10_000,
    minProofMode: 1,
    startsAt: iso(now - 9 * DAY),
    endsAt: iso(now + 30 * DAY),
    balance: (180n * 10n ** 18n).toString(),
    funded: (250n * 10n ** 18n).toString(),
    settledCount: 23,
    settledAmount: (70n * 10n ** 18n).toString(),
    status: "live",
  },
  {
    ...CAMPAIGN_SUMMARY,
    id: "2",
    name: "Hackathon week, Mumbai",
    startsAt: iso(now - 30 * DAY),
    endsAt: iso(now - 6 * DAY),
    balance: "38000000",
    funded: "300000000",
    settledCount: 131,
    settledAmount: "262000000",
    status: "refundable",
  },
];

export const CAMPAIGN_DETAIL: SponsorCampaignDetail = {
  ...CAMPAIGN_SUMMARY,
  events: [
    { ...EVENTS[0]!, approved: true, settled: 34 },
    { ...EVENTS[1]!, approved: true, settled: 8 },
    { ...EVENTS[2]!, approved: true, settled: 0 },
  ],
  settlements: SETTLED,
};

export const EMPTY_DETAIL: SponsorCampaignDetail = {
  ...CAMPAIGN_SUMMARY,
  balance: FUNDED.toString(),
  settledCount: 0,
  settledAmount: "0",
  events: [],
  settlements: [],
};

export function onChainCampaign(overrides: Partial<CampaignStruct> = {}): CampaignStruct {
  return {
    sponsor: SPONSOR,
    pricing: 0,
    attendeeShareBps: 6_000,
    feeBps: FEE_BPS,
    minProofMode: 2,
    requireQieId: false,
    openToBonded: false,
    token: ADDR.qusdc,
    maxPerEvent: 150,
    maxTotal: 0,
    settledCount: SETTLED.length,
    startsAt: BigInt(Math.floor((now - 5 * DAY) / 1000)),
    endsAt: BigInt(Math.floor((now + 20 * DAY) / 1000)),
    amountPerPresence: AMOUNT,
    minBond: 0n,
    balance: FUNDED - SETTLED_AMOUNT,
    ...overrides,
  };
}
