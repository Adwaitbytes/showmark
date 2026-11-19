import { describe, expect, it } from "vitest";
import { parseSiweMessage } from "viem/siwe";
import { buildSignInMessage, SIGN_IN_STATEMENT } from "./session";

describe("buildSignInMessage", () => {
  it("builds an EIP-4361 message bound to this site, chain and nonce, valid for ten minutes", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    const message = buildSignInMessage({
      address: "0xA8C849C243BA940102d2deB99971e4c713411926",
      nonce: "a1b2c3d4e5f6",
      host: "showmark.app",
      origin: "https://showmark.app",
      now,
    });
    const parsed = parseSiweMessage(message);
    expect(parsed).toMatchObject({
      address: "0xA8C849C243BA940102d2deB99971e4c713411926",
      domain: "showmark.app",
      uri: "https://showmark.app",
      nonce: "a1b2c3d4e5f6",
      version: "1",
      statement: SIGN_IN_STATEMENT,
      chainId: 1983,
    });
    expect(parsed.expirationTime?.getTime()).toBe(now.getTime() + 10 * 60_000);
  });
});
