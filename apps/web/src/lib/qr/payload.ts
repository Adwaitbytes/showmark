import { bytesToHex, hexToBytes, isAddress, getAddress, type Address, type Hex } from "viem";

// Wire formats for the two QR codes in Showmark. Kept short so codes stay readable from the back of a hall.
//
// Door pass (mode 1), shown on the door screen and opened by any phone camera:
//   {origin}/c/{eventId}.{issuedAt}.{doorSig base64url}.{ticketKey base64url}
// The ticket key is a throwaway private key for this 15 second rotation. Only people who see the QR have it,
// and the chain only ever sees its signatures, so a door pass read from calldata cannot admit anyone else.
// Attendee code (mode 2, door scans you), shown on the attendee's phone and scanned by the door app:
//   SM2.{eventId}.{attendee}.{attendeeSig base64url}

export interface DoorPassPayload {
  eventId: bigint;
  issuedAt: bigint;
  doorSig: Hex;
  ticketKey: Hex;
}

export interface AttendeeCodePayload {
  eventId: bigint;
  attendee: Address;
  attendeeSig: Hex;
}

const SIG_BYTES = 65;
const KEY_BYTES = 32;
const DECIMAL = /^[0-9]{1,20}$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function encodeSig(sig: Hex): string {
  const bytes = hexToBytes(sig);
  if (bytes.length !== SIG_BYTES) throw new Error(`Signature must be ${SIG_BYTES} bytes, got ${bytes.length}`);
  return toBase64Url(bytes);
}

function decodeSig(text: string): Hex | null {
  const bytes = fromBase64Url(text);
  return bytes && bytes.length === SIG_BYTES ? bytesToHex(bytes) : null;
}

function encodeKey(key: Hex): string {
  const bytes = hexToBytes(key);
  if (bytes.length !== KEY_BYTES) throw new Error(`Ticket key must be ${KEY_BYTES} bytes, got ${bytes.length}`);
  return toBase64Url(bytes);
}

function decodeKey(text: string): Hex | null {
  const bytes = fromBase64Url(text);
  if (!bytes || bytes.length !== KEY_BYTES || bytes.every((b) => b === 0)) return null;
  return bytesToHex(bytes);
}

export function encodeDoorPass(p: DoorPassPayload): string {
  return `${p.eventId}.${p.issuedAt}.${encodeSig(p.doorSig)}.${encodeKey(p.ticketKey)}`;
}

export function doorPassUrl(origin: string, p: DoorPassPayload): string {
  return `${origin.replace(/\/$/, "")}/c/${encodeDoorPass(p)}`;
}

/** Accepts the bare token or a full URL containing /c/{token}. Returns null for anything malformed. */
export function decodeDoorPass(input: string): DoorPassPayload | null {
  const trimmed = input.trim();
  const token = trimmed.includes("/c/") ? trimmed.slice(trimmed.lastIndexOf("/c/") + 3).split(/[?#]/)[0] : trimmed;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [eventId, issuedAt, sig, key] = parts;
  if (!DECIMAL.test(eventId) || !DECIMAL.test(issuedAt)) return null;
  const doorSig = decodeSig(sig);
  const ticketKey = decodeKey(key);
  if (!doorSig || !ticketKey) return null;
  return { eventId: BigInt(eventId), issuedAt: BigInt(issuedAt), doorSig, ticketKey };
}

export function encodeAttendeeCode(p: AttendeeCodePayload): string {
  return `SM2.${p.eventId}.${p.attendee}.${encodeSig(p.attendeeSig)}`;
}

export function decodeAttendeeCode(input: string): AttendeeCodePayload | null {
  const parts = input.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "SM2") return null;
  const [, eventId, attendee, sig] = parts;
  if (!DECIMAL.test(eventId) || !isAddress(attendee)) return null;
  const attendeeSig = decodeSig(sig);
  if (!attendeeSig) return null;
  return { eventId: BigInt(eventId), attendee: getAddress(attendee), attendeeSig };
}
