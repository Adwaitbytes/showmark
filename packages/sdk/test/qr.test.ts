import { fileURLToPath } from "node:url";
import { bytesToHex, getAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  ShowmarkInputError,
  decodeAttendeeCode,
  decodeDoorPass,
  doorPassUrl,
  encodeAttendeeCode,
  encodeDoorPass,
  fromBase64Url,
  toBase64Url,
  type AttendeeCodePayload,
  type DoorPassPayload,
} from "@showmark/sdk";

const sig: Hex = `0x${"ab".repeat(64)}1b`;
const ticketKey: Hex = `0x${"cd".repeat(32)}`;
const goodSig = toBase64Url(new Uint8Array(65));
const goodKey = toBase64Url(new Uint8Array(32).fill(7));

interface CodecModule {
  toBase64Url(bytes: Uint8Array): string;
  fromBase64Url(text: string): Uint8Array | null;
  encodeDoorPass(p: DoorPassPayload): string;
  doorPassUrl(origin: string, p: DoorPassPayload): string;
  decodeDoorPass(input: string): DoorPassPayload | null;
  encodeAttendeeCode(p: AttendeeCodePayload): string;
  decodeAttendeeCode(input: string): AttendeeCodePayload | null;
}

// Loaded by path at runtime so the SDK's stricter compiler settings do not apply to the app's file.
const webPayloadPath = fileURLToPath(new URL("../../../apps/web/src/lib/qr/payload.ts", import.meta.url));
const web = (await import(/* @vite-ignore */ webPayloadPath)) as CodecModule;
const sdk: CodecModule = { toBase64Url, fromBase64Url, encodeDoorPass, doorPassUrl, decodeDoorPass, encodeAttendeeCode, decodeAttendeeCode };

// Deterministic pseudo-random bytes so failures reproduce.
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

function randomBytes(next: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => Math.floor(next() * 256));
}

describe("door pass codec", () => {
  it("round-trips through the bare token and the full URL", () => {
    const p = { eventId: 42n, issuedAt: 1795073006n, doorSig: sig, ticketKey };
    expect(decodeDoorPass(encodeDoorPass(p))).toEqual(p);
    expect(decodeDoorPass(doorPassUrl("https://showmark.example/", p))).toEqual(p);
    expect(decodeDoorPass(`${doorPassUrl("https://showmark.example", p)}?utm=poster#top`)).toEqual(p);
    expect(decodeDoorPass(`  ${encodeDoorPass(p)}\n`)).toEqual(p);
  });

  it("keeps the token short enough for a readable QR", () => {
    expect(encodeDoorPass({ eventId: 42n, issuedAt: 1795073006n, doorSig: sig, ticketKey })).toHaveLength(2 + 1 + 10 + 1 + 87 + 1 + 43);
  });

  it("rejects malformed input instead of throwing", () => {
    const bad = [
      "",
      "1.2",
      "x.2.abc.def",
      `1.2.!!!.${goodKey}`,
      `1.2.${"A".repeat(10)}.${goodKey}`,
      "https://x/c/1.2",
      `1.2.${goodSig}`,
      `1.2.${toBase64Url(new Uint8Array(64))}.${goodKey}`,
      `1.2.${toBase64Url(new Uint8Array(66))}.${goodKey}`,
      `1.2.${goodSig}.${toBase64Url(new Uint8Array(31).fill(7))}`,
      `1.2.${goodSig}.${toBase64Url(new Uint8Array(33).fill(7))}`,
      `1.2.${goodSig}.${toBase64Url(new Uint8Array(32))}`,
      `-1.2.${goodSig}.${goodKey}`,
      `1.2.3.${goodSig}.${goodKey}`,
      `123456789012345678901.2.${goodSig}.${goodKey}`,
      `1.2.${goodSig}.${goodKey}=`,
    ];
    for (const input of bad) expect(decodeDoorPass(input), input).toBeNull();
  });

  it("throws a typed error when asked to encode a signature that is not 65 bytes", () => {
    expect(() => encodeDoorPass({ eventId: 1n, issuedAt: 1n, doorSig: "0x1234", ticketKey })).toThrow(ShowmarkInputError);
    expect(() => encodeDoorPass({ eventId: 1n, issuedAt: 1n, doorSig: "0xzz" as Hex, ticketKey })).toThrow(ShowmarkInputError);
    expect(() => encodeDoorPass({ eventId: 1n, issuedAt: 1n, doorSig: sig, ticketKey: "0x1234" })).toThrow(ShowmarkInputError);
  });
});

describe("attendee code codec", () => {
  const attendee: Address = "0xA8C849C243BA940102d2deB99971e4c713411926";

  it("round-trips and checksums the address", () => {
    const p = { eventId: 7n, attendee, attendeeSig: sig };
    expect(decodeAttendeeCode(encodeAttendeeCode(p))).toEqual(p);
    expect(decodeAttendeeCode(encodeAttendeeCode(p).toLowerCase().replace("sm2", "SM2"))?.attendee).toBe(attendee);
  });

  it("rejects other prefixes, bad checksums and short signatures", () => {
    const good = toBase64Url(new Uint8Array(65));
    expect(decodeAttendeeCode(`SM1.1.0x0000000000000000000000000000000000000000.${good}`)).toBeNull();
    expect(decodeAttendeeCode(`SM2.1.0xA8c849C243BA940102d2deB99971e4c713411926.${good}`)).toBeNull();
    expect(decodeAttendeeCode(`SM2.1.${attendee}.${toBase64Url(new Uint8Array(64))}`)).toBeNull();
    expect(decodeAttendeeCode(`SM2.x.${attendee}.${good}`)).toBeNull();
    expect(decodeAttendeeCode(`SM2.1.${attendee}`)).toBeNull();
    expect(decodeAttendeeCode("")).toBeNull();
  });
});

describe("parity with apps/web/src/lib/qr/payload.ts", () => {
  const next = rng(1990);

  it("encodes and decodes 500 random payloads to the same strings and values", () => {
    for (let i = 0; i < 500; i++) {
      const doorSig = bytesToHex(randomBytes(next, 65));
      const eventId = BigInt(Math.floor(next() * 2 ** 40));
      const issuedAt = BigInt(Math.floor(next() * 2 ** 33));
      const attendee = getAddress(bytesToHex(randomBytes(next, 20)));
      const key = randomBytes(next, 32);
      key[0] = (key[0] ?? 0) | 1;
      const pass = { eventId, issuedAt, doorSig, ticketKey: bytesToHex(key) };
      const code = { eventId, attendee, attendeeSig: doorSig };

      const token = sdk.encodeDoorPass(pass);
      expect(token).toBe(web.encodeDoorPass(pass));
      expect(sdk.doorPassUrl("https://showmark.example/", pass)).toBe(web.doorPassUrl("https://showmark.example/", pass));
      expect(sdk.decodeDoorPass(token)).toEqual(web.decodeDoorPass(token));
      expect(sdk.encodeAttendeeCode(code)).toBe(web.encodeAttendeeCode(code));
      expect(sdk.decodeAttendeeCode(sdk.encodeAttendeeCode(code))).toEqual(web.decodeAttendeeCode(web.encodeAttendeeCode(code)));
    }
  });

  it("agrees on 2,000 mutated and random strings, including every rejection", () => {
    const alphabet = "0123456789abcdefABCDEF.-_/:?#=+ SMx";
    const seeds = [
      sdk.encodeDoorPass({ eventId: 42n, issuedAt: 1795073006n, doorSig: sig, ticketKey }),
      sdk.encodeAttendeeCode({ eventId: 7n, attendee: "0xA8C849C243BA940102d2deB99971e4c713411926", attendeeSig: sig }),
    ];
    for (let i = 0; i < 2000; i++) {
      const base = seeds[i % 2] ?? "";
      const chars = base.split("");
      const edits = 1 + Math.floor(next() * 3);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(next() * (chars.length + 1));
        const ch = alphabet[Math.floor(next() * alphabet.length)] ?? "";
        const op = next();
        if (op < 0.33) chars.splice(at, 1);
        else if (op < 0.66) chars.splice(at, 0, ch);
        else chars[at] = ch;
      }
      const input = i % 10 === 0 ? `https://showmark.example/c/${chars.join("")}` : chars.join("");
      expect(sdk.decodeDoorPass(input), input).toEqual(web.decodeDoorPass(input));
      expect(sdk.decodeAttendeeCode(input), input).toEqual(web.decodeAttendeeCode(input));
    }
  });

  it("agrees on base64url for every length from 0 to 70 bytes", () => {
    for (let n = 0; n <= 70; n++) {
      const bytes = randomBytes(next, n);
      const text = sdk.toBase64Url(bytes);
      expect(text).toBe(web.toBase64Url(bytes));
      expect(sdk.fromBase64Url(text)).toEqual(web.fromBase64Url(text));
      expect(sdk.fromBase64Url(`${text}A`)).toEqual(web.fromBase64Url(`${text}A`));
    }
  });
});
