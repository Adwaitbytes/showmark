import { bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp } from "drizzle-orm/pg-core";

// Mirrors docs/INTERFACES.md section 4, plus four tables the indexer needs that the spec does not list
// (series, settlement_skips, refunds, transactions) and a few extra columns marked below.
// Addresses and hashes are stored lowercase. Token amounts are exact (numeric, read as bigint).

const amount = (name: string) => numeric(name, { mode: "bigint" });
const blockNumber = (name: string) => bigint(name, { mode: "bigint" });
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const syncState = pgTable(
  "sync_state",
  {
    chainId: integer("chain_id").notNull(),
    contract: text("contract").notNull(),
    lastBlock: blockNumber("last_block").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.contract] })],
);

export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    organizer: text("organizer").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    capacity: integer("capacity").notNull(),
    checkedIn: integer("checked_in").notNull().default(0),
    maxPassAge: integer("max_pass_age").notNull(),
    seriesId: bigint("series_id", { mode: "bigint" }).notNull(),
    seriesIndex: integer("series_index").notNull(),
    name: text("name").notNull(),
    venue: text("venue").notNull(),
    city: text("city").notNull(),
    description: text("description").notNull(),
    url: text("url"),
    createdBlock: blockNumber("created_block").notNull(),
    createdTx: text("created_tx").notNull(),
  },
  (t) => [index("events_organizer_idx").on(t.organizer), index("events_ends_at_idx").on(t.endsAt)],
);

/** Not in the spec: series names for passport streaks. */
export const series = pgTable("series", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  organizer: text("organizer").notNull(),
  name: text("name").notNull(),
  createdBlock: blockNumber("created_block").notNull(),
  createdTx: text("created_tx").notNull(),
});

export const presences = pgTable(
  "presences",
  {
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    attendee: text("attendee").notNull(),
    mode: smallint("mode").notNull(),
    doorKey: text("door_key").notNull(),
    doorTime: time("door_time").notNull(),
    streak: integer("streak").notNull(),
    block: blockNumber("block").notNull(),
    tx: text("tx").notNull(),
    at: time("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.attendee] }), index("presences_attendee_idx").on(t.attendee), index("presences_at_idx").on(t.at)],
);

export const links = pgTable("links", {
  pass: text("pass").primaryKey(),
  wallet: text("wallet").notNull().unique(),
  block: blockNumber("block").notNull(),
  tx: text("tx").notNull(),
});

export const campaigns = pgTable(
  "campaigns",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    sponsor: text("sponsor").notNull(),
    token: text("token").notNull(),
    pricing: smallint("pricing").notNull(),
    amountPerPresence: amount("amount_per_presence").notNull(),
    attendeeShareBps: integer("attendee_share_bps").notNull(),
    minProofMode: smallint("min_proof_mode").notNull(),
    requireQieId: boolean("require_qie_id").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    feeBps: integer("fee_bps").notNull(),
    name: text("name").notNull(),
    sponsorName: text("sponsor_name").notNull(),
    description: text("description").notNull(),
    /** Not in the spec: optional link from the campaign metadata. */
    url: text("url"),
    teamFunded: boolean("team_funded").notNull(),
    /** Not in the spec: block of CampaignCreated, for ordering. */
    createdBlock: blockNumber("created_block").notNull(),
    createdTx: text("created_tx").notNull(),
  },
  (t) => [index("campaigns_sponsor_idx").on(t.sponsor)],
);

export const campaignEvents = pgTable(
  "campaign_events",
  {
    campaignId: bigint("campaign_id", { mode: "bigint" }).notNull(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    approved: boolean("approved").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.eventId] }), index("campaign_events_event_idx").on(t.eventId)],
);

export const settlements = pgTable(
  "settlements",
  {
    campaignId: bigint("campaign_id", { mode: "bigint" }).notNull(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    attendee: text("attendee").notNull(),
    organizer: text("organizer").notNull(),
    gross: amount("gross").notNull(),
    toAttendee: amount("to_attendee").notNull(),
    toOrganizer: amount("to_organizer").notNull(),
    fee: amount("fee").notNull(),
    price: amount("price").notNull(),
    block: blockNumber("block").notNull(),
    tx: text("tx").notNull(),
    at: time("at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.eventId, t.attendee] }),
    index("settlements_attendee_idx").on(t.attendee),
    index("settlements_event_idx").on(t.eventId),
  ],
);

/** Not in the spec: the latest SettlementSkipped status per item, so the passport can say why a payout is pending. */
export const settlementSkips = pgTable(
  "settlement_skips",
  {
    campaignId: bigint("campaign_id", { mode: "bigint" }).notNull(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    attendee: text("attendee").notNull(),
    status: smallint("status").notNull(),
    block: blockNumber("block").notNull(),
    tx: text("tx").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.eventId, t.attendee] })],
);

export const fundings = pgTable(
  "fundings",
  {
    campaignId: bigint("campaign_id", { mode: "bigint" }).notNull(),
    fromAddr: text("from_addr").notNull(),
    amount: amount("amount").notNull(),
    block: blockNumber("block").notNull(),
    tx: text("tx").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tx, t.logIndex] }), index("fundings_campaign_idx").on(t.campaignId)],
);

/** Not in the spec: Refunded events, so a campaign's remaining balance and status are exact. */
export const refunds = pgTable(
  "refunds",
  {
    campaignId: bigint("campaign_id", { mode: "bigint" }).notNull(),
    sponsor: text("sponsor").notNull(),
    amount: amount("amount").notNull(),
    block: blockNumber("block").notNull(),
    tx: text("tx").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tx, t.logIndex] }), index("refunds_campaign_idx").on(t.campaignId)],
);

export const withdrawals = pgTable(
  "withdrawals",
  {
    token: text("token").notNull(),
    account: text("account").notNull(),
    toAddr: text("to_addr").notNull(),
    amount: amount("amount").notNull(),
    block: blockNumber("block").notNull(),
    tx: text("tx").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tx, t.logIndex] }), index("withdrawals_account_idx").on(t.account)],
);

/** Not in the spec: every transaction that emitted a Showmark log, for the transaction count on /traction. */
export const transactions = pgTable(
  "transactions",
  {
    hash: text("hash").primaryKey(),
    block: blockNumber("block").notNull(),
    at: time("at").notNull(),
  },
  (t) => [index("transactions_at_idx").on(t.at)],
);

export const profiles = pgTable("profiles", {
  address: text("address").primaryKey(),
  qieName: text("qie_name"),
  firstSeenBlock: blockNumber("first_seen_block").notNull(),
  /** Null until the explorer has been asked whether the address had any activity before first_seen_block. */
  firstSeenViaShowmark: boolean("first_seen_via_showmark"),
  /** Not in the spec: the root registry recorded a QIE ID (userDomain non-empty) at the last check. */
  holdsQieId: boolean("holds_qie_id"),
  updatedAt: time("updated_at").notNull(),
});

export const doorQueue = pgTable(
  "door_queue",
  {
    id: text("id").primaryKey(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: time("received_at").notNull(),
    submittedTx: text("submitted_tx"),
  },
  (t) => [index("door_queue_event_idx").on(t.eventId)],
);
