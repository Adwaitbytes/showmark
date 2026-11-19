import { createPublicClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it } from "vitest";
import { qieTestnet } from "@/lib/chain/chains";
import { MemoryStore } from "../kv";
import { newSession, SESSION_IDLE_SECONDS, SESSION_MAX_SECONDS, sessionCookieHeader, signSession, slide, verifySession } from "./session";
import { createChallenge, verifySignIn } from "./signin";

// anvil's second default key, used only in this test.
const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const SECRET = "test-secret-that-is-at-least-32-characters-long";

// The universal signature validator runs as an eth_call; answering "false" makes viem fall back to ECDSA
// recovery, which is exactly what happens on a real node for an EOA.
const client = createPublicClient({
  chain: qieTestnet,
  transport: custom({
    async request({ method }: { method: string }) {
      if (method === "eth_chainId") return "0x7bf";
      if (method === "eth_call") return `0x${"00".repeat(32)}`;
      throw new Error(`unexpected ${method}`);
    },
  }),
});

const domain = "showmark.test";
const now = new Date("2026-11-19T10:00:00Z");

describe("sign-in message", () => {
  let kv: MemoryStore;
  beforeEach(() => {
    kv = new MemoryStore(() => now.getTime());
  });

  async function challenge() {
    return createChallenge(kv, { address: wallet.address, domain, uri: `https://${domain}`, chainId: qieTestnet.id, now });
  }

  it("includes domain, chain id, nonce, issued-at and expiry", async () => {
    const c = await challenge();
    const parsed = parseSiweMessage(c.message);
    expect(parsed).toMatchObject({ domain, address: wallet.address, chainId: 1983, nonce: c.nonce, version: "1", uri: `https://${domain}` });
    expect(parsed.issuedAt?.toISOString()).toBe(now.toISOString());
    expect(parsed.expirationTime?.toISOString()).toBe(new Date(now.getTime() + 5 * 60_000).toISOString());
    expect(c.message).not.toMatch(/[—–!]/);
  });

  it("verifies a correct signature once and rejects a replay", async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message });
    const req = { message: c.message, signature, domain, chainId: qieTestnet.id, now };
    expect(await verifySignIn(kv, client, req)).toBe(wallet.address);
    await expect(verifySignIn(kv, client, req)).rejects.toMatchObject({ status: 401, copy: { code: "auth_nonce_invalid" } });
  });

  it("rejects a signature from a different wallet", async () => {
    const c = await challenge();
    const signature = await other.signMessage({ message: c.message });
    await expect(verifySignIn(kv, client, { message: c.message, signature, domain, chainId: qieTestnet.id, now })).rejects.toMatchObject({
      copy: { code: "auth_signature_invalid" },
    });
  });

  it("rejects a message made for another site or chain", async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message });
    await expect(verifySignIn(kv, client, { message: c.message, signature, domain: "evil.test", chainId: qieTestnet.id, now })).rejects.toMatchObject({
      copy: { code: "auth_domain_mismatch" },
    });
    const c2 = await challenge();
    const sig2 = await wallet.signMessage({ message: c2.message });
    await expect(verifySignIn(kv, client, { message: c2.message, signature: sig2, domain, chainId: 1990, now })).rejects.toMatchObject({
      copy: { code: "auth_domain_mismatch" },
    });
  });

  it("rejects an expired nonce and a message edited after signing", async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message });
    const later = new Date(now.getTime() + 6 * 60_000);
    const expiredKv = new MemoryStore(() => later.getTime());
    await expect(verifySignIn(expiredKv, client, { message: c.message, signature, domain, chainId: qieTestnet.id, now: later })).rejects.toMatchObject({ status: 401 });

    const c2 = await challenge();
    const sig2 = await wallet.signMessage({ message: c2.message });
    const tampered = c2.message.replace("Sign in to Showmark.", "Sign in to Showmark now.");
    await expect(verifySignIn(kv, client, { message: tampered, signature: sig2, domain, chainId: qieTestnet.id, now })).rejects.toMatchObject({
      copy: { code: "auth_signature_invalid" },
    });
  });

  it("rejects garbage", async () => {
    await expect(verifySignIn(kv, client, { message: "hello", signature: "0x00", domain, chainId: qieTestnet.id, now })).rejects.toMatchObject({ status: 400 });
  });
});

describe("session cookie", () => {
  const t0 = 1_795_000_000;

  it("round-trips a signed session", async () => {
    const session = newSession(wallet.address, t0);
    const cookie = await signSession(session, SECRET);
    expect(cookie).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifySession(cookie, SECRET, t0 + 1)).toEqual(session);
  });

  it("rejects a forged payload, a wrong key and malformed values", async () => {
    const cookie = await signSession(newSession(wallet.address, t0), SECRET);
    const [, , mac] = cookie.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ a: other.address, iat: t0, exp: t0 + 900, max: t0 + 43_200 })).toString("base64url");
    expect(await verifySession(`v1.${forgedBody}.${mac}`, SECRET, t0 + 1)).toBeNull();
    expect(await verifySession(cookie, `${SECRET}x`, t0 + 1)).toBeNull();
    expect(await verifySession("v1.abc", SECRET, t0)).toBeNull();
    expect(await verifySession("v2.a.b", SECRET, t0)).toBeNull();
    expect(await verifySession(undefined, SECRET, t0)).toBeNull();
  });

  it("expires after 15 idle minutes and slides up to the 12 hour maximum", async () => {
    const session = newSession(wallet.address, t0);
    const cookie = await signSession(session, SECRET);
    expect(await verifySession(cookie, SECRET, t0 + SESSION_IDLE_SECONDS)).toBeNull();

    let current = session;
    for (let t = t0 + 600; t < t0 + SESSION_MAX_SECONDS; t += 600) current = slide(current, t);
    expect(current.expiresAt).toBe(t0 + SESSION_MAX_SECONDS);
    const late = await signSession(current, SECRET);
    expect(await verifySession(late, SECRET, t0 + SESSION_MAX_SECONDS - 1)).not.toBeNull();
    expect(await verifySession(late, SECRET, t0 + SESSION_MAX_SECONDS)).toBeNull();
  });

  it("sets the cookie httpOnly, Secure and SameSite=Lax", () => {
    const header = sessionCookieHeader("v1.a.b", 900);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=900");
  });
});
