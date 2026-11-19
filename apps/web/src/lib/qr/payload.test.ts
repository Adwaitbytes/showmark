import { describe, expect, it } from "vitest";
import { decodeAttendeeCode, decodeDoorPass, doorPassUrl, encodeAttendeeCode, encodeDoorPass } from "./payload";

const sig = `0x${"ab".repeat(64)}1b` as const;

describe("door pass codec", () => {
  it("round-trips through the bare token and the full URL", () => {
    const p = { eventId: 42n, issuedAt: 1795073006n, doorSig: sig };
    expect(decodeDoorPass(encodeDoorPass(p))).toEqual(p);
    expect(decodeDoorPass(doorPassUrl("https://showmark.example/", p))).toEqual(p);
  });

  it("rejects malformed input instead of throwing", () => {
    for (const bad of ["", "1.2", "x.2.abc", "1.2.!!!", `1.2.${"A".repeat(10)}`, "https://x/c/1.2"]) {
      expect(decodeDoorPass(bad)).toBeNull();
    }
  });
});

describe("attendee code codec", () => {
  it("round-trips and checksums the address", () => {
    const p = { eventId: 7n, attendee: "0xA8C849C243BA940102d2deB99971e4c713411926" as const, attendeeSig: sig };
    expect(decodeAttendeeCode(encodeAttendeeCode(p))).toEqual(p);
    expect(decodeAttendeeCode(encodeAttendeeCode(p).toLowerCase().replace("sm2", "SM2"))?.attendee).toBe(p.attendee);
  });

  it("rejects other prefixes", () => {
    expect(decodeAttendeeCode("SM1.1.0x0000000000000000000000000000000000000000.AA")).toBeNull();
  });
});
