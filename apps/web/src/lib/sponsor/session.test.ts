import { describe, expect, it } from "vitest";
import { createSiweMessage } from "viem/siwe";
import { challengeMatches } from "./session";

const ADDRESS = "0xA8C849C243BA940102d2deB99971e4c713411926";

function message(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: ADDRESS,
    chainId: 1983,
    domain: "showmark.app",
    uri: "https://showmark.app",
    nonce: "a1b2c3d4e5f6",
    version: "1",
    ...overrides,
  });
}

describe("challengeMatches", () => {
  const expected = { address: ADDRESS, host: "showmark.app", nonce: "a1b2c3d4e5f6" } as const;

  it("accepts the message the server issued for this wallet, site, chain and nonce", () => {
    expect(challengeMatches(message(), expected)).toBe(true);
    expect(challengeMatches(message(), { ...expected, address: ADDRESS.toLowerCase() as `0x${string}` })).toBe(true);
  });

  it("refuses a message for another site, chain, wallet or nonce", () => {
    expect(challengeMatches(message({ domain: "evil.example" }), expected)).toBe(false);
    expect(challengeMatches(message({ chainId: 1990 }), expected)).toBe(false);
    expect(challengeMatches(message({ address: "0x0000000000000000000000000000000000000001" }), expected)).toBe(false);
    expect(challengeMatches(message({ nonce: "zzzzzzzzzzzz" }), expected)).toBe(false);
    expect(challengeMatches("not a sign-in message", expected)).toBe(false);
  });
});
