import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ShowmarkError, explorerTxUrl, qieMainnet, type ShowmarkClient } from "@showmark/sdk";
import type { Chain, Hex } from "viem";
import { z } from "zod";
import { ShowmarkDataError, type ShowmarkDataSource } from "./data";
import { address, decimal, traction as tractionSchema } from "./schemas";

export const SERVER_NAME = "showmark";
export const SERVER_VERSION = "0.1.0";

export interface ShowmarkMcpOptions {
  /** Indexed data: events, campaigns, settlements, passports, traction. Tools that need it fail politely without it. */
  data?: ShowmarkDataSource;
  /** Chain reads through the SDK. Needed for showmark_has_attended and the on-chain checks in other tools. */
  client?: ShowmarkClient;
  /** Chain used for explorer links. Defaults to the client's chain, then QIE mainnet. */
  chain?: Chain;
}

const INSTRUCTIONS = [
  "Showmark is presence-conditional sponsorship on the QIE blockchain. Sponsors lock QIE or QUSDC in escrow, organizers run real events with a signed door QR, attendees check in gaslessly, and each verified presence releases a payout split between organizer and attendee.",
  "Every tool here is read-only. Amounts are integer strings in token base units: QIE has 18 decimals, QUSDC has 6.",
  "Use showmark_verified_reach to see exactly which presences a campaign paid for, each with an explorer link. Use showmark_has_attended for a direct on-chain answer about one person at one event.",
  "Traction separates team-funded pools from external sponsors; report them separately.",
].join(" ");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const idInput = (what: string) => z.string().regex(/^[0-9]{1,78}$/).describe(`${what} id as a decimal string, for example "42"`);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function ok(structured: { [key: string]: Json }): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function fail(message: string, action: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${message} ${action}` }] };
}

function failFrom(error: unknown): CallToolResult {
  if (error instanceof ShowmarkDataError) return fail(error.message, error.action);
  if (error instanceof ShowmarkError) {
    const action = error.code === "CONFIG" ? "Ask the server operator to configure the Showmark contract addresses." : "Try again in a few seconds.";
    return fail(error.message, action);
  }
  return fail("Something went wrong while reading Showmark data.", "Try again in a few seconds.");
}

function sumDecimal(values: readonly string[]): string {
  return values.reduce((total, v) => total + BigInt(v), 0n).toString();
}

/**
 * Builds the read-only Showmark MCP server. Connect it to a stdio or Streamable HTTP transport; for stateless HTTP,
 * build one per request (see handleMcpRequest).
 */
export function createShowmarkMcpServer(options: ShowmarkMcpOptions): McpServer {
  const chain = options.chain ?? options.client?.chain ?? qieMainnet;
  const txUrl = (hash: string): string | null => explorerTxUrl(chain, hash as Hex);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  function needData(): ShowmarkDataSource {
    if (!options.data) {
      throw new ShowmarkDataError({
        code: "no_api",
        message: "This MCP server has no Showmark API configured.",
        action: "Set SHOWMARK_API_URL to the Showmark site, for example https://showmark.app.",
      });
    }
    return options.data;
  }

  function needClient(): { client: ShowmarkClient; registry: string } {
    const registry = options.client?.addresses.registry;
    if (!options.client || !registry) {
      throw new ShowmarkDataError({
        code: "no_chain",
        message: "This server has no ShowmarkRegistry address yet, so it cannot read presence from the chain.",
        action: "Try again once the contracts are deployed. When you run showmark-mcp yourself, set SHOWMARK_REGISTRY_ADDRESS.",
      });
    }
    return { client: options.client, registry };
  }

  server.registerTool(
    "showmark_traction",
    {
      title: "Showmark traction",
      description:
        "Live network numbers: verified attendees, events with check-ins, organizers, sponsors (team-funded and external), value settled per token and in USD, wallet conversion, repeat attendees and Showmark's share of QIE daily transactions.",
      outputSchema: tractionSchema.shape,
      annotations: READ_ONLY,
    },
    async () => {
      try {
        return ok(await needData().getTraction());
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  const eventRow = z.object({
    id: decimal,
    name: z.string(),
    venue: z.string(),
    city: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    checkedIn: z.number(),
    capacity: z.number(),
    organizer: address,
    organizerName: z.string().nullable(),
    seriesId: decimal,
    createdTxUrl: z.string().nullable(),
  });

  server.registerTool(
    "showmark_list_events",
    {
      title: "List Showmark events",
      description: "Events recorded on Showmark, newest first, or soonest first with upcoming=true. Filter by organizer address.",
      inputSchema: {
        organizer: address.optional().describe("Only events created by this organizer address"),
        upcoming: z.boolean().optional().describe("Only events that have not ended, soonest first"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum number of events, 1 to 100. Defaults to 20"),
      },
      outputSchema: { count: z.number(), events: z.array(eventRow) },
      annotations: READ_ONLY,
    },
    async ({ organizer, upcoming, limit }) => {
      try {
        const max = limit ?? 20;
        const events = await needData().listEvents({
          ...(organizer ? { organizer: organizer as `0x${string}` } : {}),
          ...(upcoming ? { upcoming } : {}),
          limit: max,
        });
        const rows = events.slice(0, max).map((e) => ({
          id: e.id,
          name: e.metadata.name,
          venue: e.metadata.venue,
          city: e.metadata.city,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          checkedIn: e.checkedIn,
          capacity: e.capacity,
          organizer: e.organizer,
          organizerName: e.organizerName,
          seriesId: e.seriesId,
          createdTxUrl: txUrl(e.createdTx),
        }));
        return ok({ count: rows.length, events: rows });
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  server.registerTool(
    "showmark_get_event",
    {
      title: "Get a Showmark event",
      description:
        "One event with its metadata, check-in count, the campaigns paying for presence there, and recent check-ins with explorer links. When chain reads are configured, the check-in count is also read from the registry.",
      inputSchema: { eventId: idInput("Event") },
      outputSchema: {
        event: z.object({
          id: decimal,
          name: z.string(),
          venue: z.string(),
          city: z.string(),
          description: z.string(),
          startsAt: z.string(),
          endsAt: z.string(),
          organizer: address,
          organizerName: z.string().nullable(),
          capacity: z.number(),
          checkedIn: z.number(),
          seriesId: decimal,
          seriesIndex: z.number(),
          campaigns: z.array(
            z.object({ id: decimal, name: z.string(), sponsorName: z.string(), tokenSymbol: z.string(), attendeeAmount: decimal, requireQieId: z.boolean(), minProofMode: z.number() }),
          ),
          recentCheckIns: z.array(z.object({ attendee: address, name: z.string().nullable(), at: z.string(), mode: z.number(), txUrl: z.string().nullable() })),
        }),
        onChain: z.object({ checkedIn: z.number(), organizer: address, matchesIndex: z.boolean() }).nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ eventId }) => {
      try {
        const e = await needData().getEvent(eventId);
        if (!e) return fail(`No Showmark event has id ${eventId}.`, "Use showmark_list_events to find event ids.");
        let onChain: { checkedIn: number; organizer: string; matchesIndex: boolean } | null = null;
        if (options.client?.addresses.registry) {
          const info = await options.client.getEvent(BigInt(eventId));
          if (info) {
            onChain = { checkedIn: info.checkedIn, organizer: info.organizer, matchesIndex: info.checkedIn === e.checkedIn && info.organizer.toLowerCase() === e.organizer.toLowerCase() };
          }
        }
        return ok({
          event: {
            id: e.id,
            name: e.metadata.name,
            venue: e.metadata.venue,
            city: e.metadata.city,
            description: e.metadata.description,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            organizer: e.organizer,
            organizerName: e.organizerName,
            capacity: e.capacity,
            checkedIn: e.checkedIn,
            seriesId: e.seriesId,
            seriesIndex: e.seriesIndex,
            campaigns: e.campaigns.map((c) => ({
              id: c.id,
              name: c.name,
              sponsorName: c.sponsorName,
              tokenSymbol: c.tokenSymbol,
              attendeeAmount: c.attendeeAmount,
              requireQieId: c.requireQieId,
              minProofMode: c.minProofMode,
            })),
            recentCheckIns: e.recentCheckIns.map((r) => ({ attendee: r.attendee, name: r.name, at: r.at, mode: r.mode, txUrl: txUrl(r.tx) })),
          },
          onChain,
        });
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  server.registerTool(
    "showmark_get_campaign",
    {
      title: "Get a Showmark campaign",
      description:
        "One sponsor campaign: token, price per verified presence, split, proof mode, eligibility, window, escrow balance, settled count and approved events. When chain reads are configured, includes the vault's live quote for one presence.",
      inputSchema: { campaignId: idInput("Campaign") },
      outputSchema: {
        campaign: z.object({
          id: decimal,
          name: z.string(),
          description: z.string(),
          sponsor: address,
          sponsorName: z.string(),
          teamFunded: z.boolean(),
          status: z.string(),
          token: address,
          tokenSymbol: z.string(),
          pricing: z.enum(["token", "usd_in_native_qie"]),
          amountPerPresence: decimal,
          attendeeShareBps: z.number(),
          feeBps: z.number(),
          minProofMode: z.number(),
          requireQieId: z.boolean(),
          startsAt: z.string(),
          endsAt: z.string(),
          balance: decimal,
          funded: decimal,
          settledCount: z.number(),
          settledAmount: decimal,
          events: z.array(z.object({ id: decimal, name: z.string(), approved: z.boolean(), settled: z.number() })),
        }),
        quote: z.object({ amount: decimal, priceFresh: z.boolean() }).nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ campaignId }) => {
      try {
        const c = await needData().getCampaign(campaignId);
        if (!c) return fail(`No Showmark campaign has id ${campaignId}.`, "Check the id on the sponsor's campaign page.");
        let quote: { amount: string; priceFresh: boolean } | null = null;
        if (options.client?.addresses.vault) {
          const q = await options.client.quote(BigInt(campaignId));
          quote = { amount: q.amount.toString(), priceFresh: q.priceFresh };
        }
        return ok({
          campaign: {
            id: c.id,
            name: c.name,
            description: c.description,
            sponsor: c.sponsor,
            sponsorName: c.sponsorName,
            teamFunded: c.teamFunded,
            status: c.status,
            token: c.token,
            tokenSymbol: c.tokenSymbol,
            pricing: c.pricing === 0 ? "token" : "usd_in_native_qie",
            amountPerPresence: c.amountPerPresence,
            attendeeShareBps: c.attendeeShareBps,
            feeBps: c.feeBps,
            minProofMode: c.minProofMode,
            requireQieId: c.requireQieId,
            startsAt: c.startsAt,
            endsAt: c.endsAt,
            balance: c.balance,
            funded: c.funded,
            settledCount: c.settledCount,
            settledAmount: c.settledAmount,
            events: c.events.map((e) => ({ id: e.id, name: e.metadata.name, approved: e.approved, settled: e.settled })),
          },
          quote,
        });
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  server.registerTool(
    "showmark_verified_reach",
    {
      title: "Verified reach of a campaign",
      description:
        "Every presence a campaign has paid for, newest first: event, attendee, gross amount, attendee and organizer shares, fee, time and an explorer link to the settlement transaction. Includes distinct attendees, distinct events and totals.",
      inputSchema: {
        campaignId: idInput("Campaign"),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum settlements to list, 1 to 500. Defaults to 50. Totals always cover every settlement returned by the API"),
      },
      outputSchema: {
        campaignId: decimal,
        name: z.string(),
        sponsorName: z.string(),
        teamFunded: z.boolean(),
        tokenSymbol: z.string(),
        settledCount: z.number(),
        distinctAttendees: z.number(),
        distinctEvents: z.number(),
        totals: z.object({ gross: decimal, toAttendee: decimal, toOrganizer: decimal, fee: decimal }),
        settlements: z.array(
          z.object({
            eventId: decimal,
            eventName: z.string(),
            attendee: address,
            organizer: address,
            gross: decimal,
            toAttendee: decimal,
            toOrganizer: decimal,
            fee: decimal,
            at: z.string(),
            tx: z.string(),
            explorerUrl: z.string().nullable(),
          }),
        ),
        truncated: z.boolean(),
      },
      annotations: READ_ONLY,
    },
    async ({ campaignId, limit }) => {
      try {
        const c = await needData().getCampaign(campaignId);
        if (!c) return fail(`No Showmark campaign has id ${campaignId}.`, "Check the id on the sponsor's campaign page.");
        const all = [...c.settlements].sort((a, b) => b.at.localeCompare(a.at));
        const max = limit ?? 50;
        return ok({
          campaignId: c.id,
          name: c.name,
          sponsorName: c.sponsorName,
          teamFunded: c.teamFunded,
          tokenSymbol: c.tokenSymbol,
          settledCount: c.settledCount,
          distinctAttendees: new Set(all.map((s) => s.attendee.toLowerCase())).size,
          distinctEvents: new Set(all.map((s) => s.eventId)).size,
          totals: {
            gross: sumDecimal(all.map((s) => s.gross)),
            toAttendee: sumDecimal(all.map((s) => s.toAttendee)),
            toOrganizer: sumDecimal(all.map((s) => s.toOrganizer)),
            fee: sumDecimal(all.map((s) => s.fee)),
          },
          settlements: all.slice(0, max).map((s) => ({
            eventId: s.eventId,
            eventName: s.eventName,
            attendee: s.attendee,
            organizer: s.organizer,
            gross: s.gross,
            toAttendee: s.toAttendee,
            toOrganizer: s.toOrganizer,
            fee: s.fee,
            at: s.at,
            tx: s.tx,
            explorerUrl: txUrl(s.tx),
          })),
          truncated: all.length > max,
        });
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  server.registerTool(
    "showmark_get_passport",
    {
      title: "Get a Showmark passport",
      description:
        "An attendee's passport by address or .qie name: linked pass and wallet, QIE ID, stamps with explorer links, streaks per series, claimable rewards and pending payouts.",
      inputSchema: { addressOrName: z.string().min(3).max(100).describe("A 0x address or a QIE ID name such as alice.qie") },
      outputSchema: {
        pass: address.nullable(),
        wallet: address.nullable(),
        qieName: z.string().nullable(),
        holdsQieId: z.boolean(),
        stampCount: z.number(),
        stamps: z.array(z.object({ eventId: decimal, eventName: z.string(), city: z.string(), at: z.string(), mode: z.number(), streak: z.number(), explorerUrl: z.string().nullable() })),
        streaks: z.array(z.object({ seriesId: decimal, seriesName: z.string(), current: z.number(), best: z.number() })),
        claimable: z.array(z.object({ token: address, symbol: z.string(), amount: decimal })),
        pending: z.array(z.object({ campaignId: decimal, eventId: decimal, reason: z.string() })),
      },
      annotations: READ_ONLY,
    },
    async ({ addressOrName }) => {
      try {
        const p = await needData().getPassport(addressOrName.trim());
        if (!p) return fail(`No Showmark passport found for ${addressOrName}.`, "Check the address or name; a passport appears after the first check-in.");
        return ok({
          pass: p.pass,
          wallet: p.wallet,
          qieName: p.qieName,
          holdsQieId: p.holdsQieId,
          stampCount: p.stamps.length,
          stamps: p.stamps.map((s) => ({ eventId: s.eventId, eventName: s.eventName, city: s.city, at: s.at, mode: s.mode, streak: s.streak, explorerUrl: txUrl(s.tx) })),
          streaks: p.streaks,
          claimable: p.claimable,
          pending: p.pending,
        });
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  server.registerTool(
    "showmark_has_attended",
    {
      title: "Check presence on chain",
      description:
        "Reads ShowmarkRegistry directly: whether an address, or the pass linked to it, has a verified presence at an event, and with which proof mode (1 rotating door QR, 2 door scanned the attendee).",
      inputSchema: { eventId: idInput("Event"), account: address.describe("A pass address or the wallet linked to it") },
      outputSchema: {
        eventId: decimal,
        account: address,
        attended: z.boolean(),
        presence: z.object({ mode: z.number(), recordedAt: z.string() }).nullable(),
        chainId: z.number(),
        registry: address,
      },
      annotations: READ_ONLY,
    },
    async ({ eventId, account }) => {
      try {
        const { client, registry } = needClient();
        const id = BigInt(eventId);
        const who = account as `0x${string}`;
        const [attended, presence] = await Promise.all([client.hasAttended(id, who), client.presenceOf(id, who)]);
        return ok({
          eventId,
          account,
          attended,
          presence: presence.present ? { mode: presence.mode, recordedAt: new Date(Number(presence.at) * 1000).toISOString() } : null,
          chainId: client.chainId,
          registry,
        });
      } catch (error) {
        return failFrom(error);
      }
    },
  );

  return server;
}
