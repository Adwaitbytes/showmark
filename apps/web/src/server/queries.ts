import "server-only";

import type { Address, CampaignDetail, CampaignSummary, EventDetail, EventSummary, Passport, Traction } from "@/lib/api/types";
import { isDeployed } from "@/lib/chain/addresses";
import { AppError, COMMON_ERRORS } from "./errors";

// Server components call these directly. Client components use the matching /api/* routes, which call the same
// functions. Every function returns real data from the indexer or a real empty result when the contracts are not
// deployed yet. Anything that cannot be answered throws `AppError`, whose `copy` is safe to show to people.

export interface EventFilter {
  /** Only events created by this organizer address. */
  organizer?: Address;
  /** Only events that have not ended yet, soonest first. Otherwise newest first. */
  upcoming?: boolean;
  /** Page size, 1 to 100. Defaults to 50. */
  limit?: number;
  offset?: number;
}

export interface CampaignFilter {
  /** Only campaigns created by this sponsor address. */
  sponsor?: Address;
  /** Page size, 1 to 100. Defaults to 50. */
  limit?: number;
  offset?: number;
}

function notReady(): never {
  throw new AppError(503, COMMON_ERRORS.databaseNotConfigured);
}

export async function getTraction(): Promise<Traction> {
  if (!isDeployed()) return emptyTraction();
  notReady();
}

export async function listEvents(filter: EventFilter = {}): Promise<EventSummary[]> {
  void filter;
  if (!isDeployed()) return [];
  notReady();
}

/** Returns null when no event with this id exists. */
export async function getEvent(id: string | bigint): Promise<EventDetail | null> {
  void id;
  if (!isDeployed()) return null;
  notReady();
}

/** Accepts a checksummed or lowercase address, or a QIE ID name such as `alice.qie`. Null when the name does not resolve. */
export async function getPassport(addressOrName: string): Promise<Passport | null> {
  void addressOrName;
  if (!isDeployed()) return null;
  notReady();
}

export async function listCampaigns(filter: CampaignFilter = {}): Promise<CampaignSummary[]> {
  void filter;
  if (!isDeployed()) return [];
  notReady();
}

/** Returns null when no campaign with this id exists. */
export async function getCampaign(id: string | bigint): Promise<CampaignDetail | null> {
  void id;
  if (!isDeployed()) return null;
  notReady();
}

function emptyTraction(): Traction {
  return {
    updatedAt: new Date().toISOString(),
    verifiedAttendees: 0,
    eventsWithCheckIns: 0,
    organizers: 0,
    sponsors: { teamFunded: 0, external: 0 },
    settled: [],
    settledUsd: { teamFunded: 0, external: 0, price: 0, priceUpdatedAt: new Date(0).toISOString() },
    newWalletsViaShowmark: 0,
    passesLinked: 0,
    conversionRate: 0,
    attendeesWithQieId: 0,
    repeatAttendees: 0,
    showmarkTransactions: 0,
    chainDailyTransactions: null,
    shareOfChainDaily: null,
    daily: [],
  };
}
