import "server-only";

import { getAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { registryAbi } from "@/lib/chain/abi";
import { checkInWindow } from "@/lib/door/rotation";
import { signDoorPass } from "@/lib/door/sign";
import { doorPassUrl } from "@/lib/qr/payload";
import { ConfigError } from "@/server/env";
import { AppError, COMMON_ERRORS, type ErrorCopy } from "@/server/errors";

// The judges' desk door. Every request signs a fresh mode 1 door pass on the server with the desk's door key and a
// new ticket key, so the desk QR works on any screen with no door laptop running. The door key never leaves the
// server; the response only carries the DoorPass signature and the one-rotation ticket key inside the URL.

export interface JudgesDeskConfig {
  doorKey: Hex;
  eventId: bigint;
}

export interface JudgesPass {
  url: string;
  issuedAt: string;
  expiresAt: string;
}

export const DESK_NOT_OPEN: ErrorCopy = {
  code: "judges_desk_not_open",
  message: "The judges' desk is not open yet.",
  action: "It opens for demo week, 1 to 10 December. Check back then, or read how a check-in works at /docs/check-in.",
};

const DESK_DOOR_NOT_READY: ErrorCopy = {
  code: "judges_desk_door_not_ready",
  message: "The judges' desk is being set up and its door is not authorized yet.",
  action: "Try again in a few minutes. If it stays like this, tell the Showmark team.",
};

const DESK_CLOSED: ErrorCopy = {
  code: "judges_desk_closed",
  message: "Check-in at the judges' desk is closed right now.",
  action: "The desk is open during demo week, 1 to 10 December.",
};

const privateKey = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/);
const eventId = z.string().trim().regex(/^[1-9]\d{0,19}$/);

/**
 * Reads JUDGES_DOOR_KEY and NEXT_PUBLIC_JUDGES_DESK_EVENT_ID. Null when either is missing, so the route can say the
 * desk is not open; a malformed value throws ConfigError, which names the variable but never prints its value.
 */
export function judgesDeskConfig(env: Record<string, string | undefined> = process.env): JudgesDeskConfig | null {
  const rawKey = env.JUDGES_DOOR_KEY?.trim();
  const rawEvent = env.NEXT_PUBLIC_JUDGES_DESK_EVENT_ID?.trim();
  if (!rawKey || !rawEvent) return null;
  const key = privateKey.safeParse(rawKey);
  if (!key.success) throw new ConfigError("JUDGES_DOOR_KEY", "must be 0x followed by 64 hex characters");
  const id = eventId.safeParse(rawEvent);
  if (!id.success) throw new ConfigError("NEXT_PUBLIC_JUDGES_DESK_EVENT_ID", "must be a positive event id");
  return { doorKey: key.data as Hex, eventId: BigInt(id.data) };
}

export interface IssueOptions {
  config: JudgesDeskConfig;
  client: PublicClient;
  registry: Address;
  origin: string;
  generateTicketKey?: () => Hex;
}

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

export async function issueJudgesPass({ config, client, registry, origin, generateTicketKey }: IssueOptions): Promise<JudgesPass> {
  if (registry === zeroAddress) throw new AppError(503, COMMON_ERRORS.notDeployed);
  const door = privateKeyToAccount(config.doorKey);

  let block: { timestamp: bigint };
  let event: { organizer: Address; startsAt: bigint; endsAt: bigint; maxPassAge: number };
  let validUntil: bigint;
  try {
    [block, event, validUntil] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.readContract({ address: registry, abi: registryAbi, functionName: "eventInfo", args: [config.eventId] }),
      client.readContract({ address: registry, abi: registryAbi, functionName: "doorKeyValidUntil", args: [config.eventId, getAddress(door.address)] }),
    ]);
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }

  if (event.organizer === zeroAddress) throw new AppError(503, DESK_NOT_OPEN);
  // Chain time, not server time: the registry judges freshness by block time.
  const issuedAt = block.timestamp;
  if (validUntil < issuedAt) throw new AppError(503, DESK_DOOR_NOT_READY);
  if (checkInWindow(issuedAt, event.startsAt, event.endsAt) !== "open") throw new AppError(409, DESK_CLOSED);

  const pass = await signDoorPass(door, config.eventId, issuedAt, registry, generateTicketKey);
  return { url: doorPassUrl(origin, pass), issuedAt: iso(issuedAt), expiresAt: iso(issuedAt + BigInt(event.maxPassAge)) };
}
