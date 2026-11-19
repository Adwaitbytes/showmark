import { zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  ShowmarkConfigError,
  ShowmarkInputError,
  ShowmarkNetworkError,
  ShowmarkRelayError,
  getTxStatus,
  relayCheckIn,
  relayCheckInBatch,
  relayLinkWallet,
  relayWithdraw,
  splitPayout,
  waitForTx,
  type CheckInData,
} from "@showmark/sdk";

const txHash: Hex = `0x${"ab".repeat(32)}`;
const sig: Hex = `0x${"11".repeat(64)}1b`;
const alice: Address = "0x5555555555555555555555555555555555555555";
const ticket: Address = "0x7777777777777777777777777777777777777777";
const data: CheckInData = { eventId: 42n, attendee: alice, mode: 1, doorTime: 1795073006n, ticket, attendeeSig: sig, doorSig: sig, ticketSig: sig };

function fetchReturning(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    return next;
  });
}

describe("relay requests", () => {
  it("posts CheckInData with bigints as decimal strings", async () => {
    const fetch = fetchReturning(Response.json({ txHash, status: "submitted" }));
    expect(await relayCheckIn({ baseUrl: "https://showmark.example/app/", fetch }, data)).toEqual({ txHash, status: "submitted" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://showmark.example/app/api/relay/check-in");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      eventId: "42",
      attendee: alice,
      mode: 1,
      doorTime: "1795073006",
      ticket,
      attendeeSig: sig,
      doorSig: sig,
      ticketSig: sig,
    });
  });

  it("posts batches, link-wallet and withdraw in the documented shapes", async () => {
    const fetch = fetchReturning(
      Response.json({ txHash, accepted: 2 }),
      Response.json({ txHash }),
      Response.json({ txHash }),
    );
    const options = { baseUrl: "https://showmark.example", fetch };
    expect(await relayCheckInBatch(options, [data, { ...data, mode: 2 }])).toEqual({ txHash, accepted: 2, rejected: [] });
    expect(
      await relayLinkWallet(options, { pass: alice, wallet: zeroAddress, deadline: 99n, passSig: sig, walletSig: sig, relocateEventIds: [1n, 2n] }),
    ).toEqual({ txHash });
    expect(await relayWithdraw(options, { token: zeroAddress, account: alice })).toEqual({ txHash });

    const bodies = fetch.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body)) as unknown]);
    expect(bodies[0]?.[0]).toBe("https://showmark.example/api/relay/check-in/batch");
    expect((bodies[0]?.[1] as { items: unknown[] }).items).toHaveLength(2);
    expect(bodies[1]).toEqual([
      "https://showmark.example/api/relay/link-wallet",
      { pass: alice, wallet: zeroAddress, deadline: "99", passSig: sig, walletSig: sig, relocateEventIds: ["1", "2"] },
    ]);
    expect(bodies[2]).toEqual(["https://showmark.example/api/relay/withdraw", { token: zeroAddress, account: alice }]);
  });

  it("returns per-item rejections from a batch, including a batch where nothing was sent", async () => {
    const already = { index: 0, code: "AlreadyPresent", message: "This pass is already checked in.", action: "Nothing to do." };
    const fetch = fetchReturning(
      Response.json({ txHash: null, accepted: 0, rejected: [already] }),
      Response.json({ txHash, accepted: 1, rejected: [{ ...already, index: 1 }] }),
      Response.json({ txHash, accepted: 1, rejected: [{ index: "x" }] }),
    );
    const options = { baseUrl: "https://showmark.example", fetch };
    expect(await relayCheckInBatch(options, [data])).toEqual({ txHash: null, accepted: 0, rejected: [already] });
    expect((await relayCheckInBatch(options, [data, data])).rejected[0]?.index).toBe(1);
    await expect(relayCheckInBatch(options, [data])).rejects.toBeInstanceOf(ShowmarkNetworkError);
  });

  it("surfaces the API error copy as ShowmarkRelayError", async () => {
    const fetch = fetchReturning(
      Response.json(
        { error: { code: "Stale", message: "This door code expired.", action: "Scan the code on the door screen again." } },
        { status: 422 },
      ),
    );
    const error = await relayCheckIn({ baseUrl: "https://showmark.example", fetch }, data).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShowmarkRelayError);
    expect(error).toMatchObject({ status: 422, apiCode: "Stale", message: "This door code expired.", action: "Scan the code on the door screen again." });
  });

  it("falls back to generic copy when the error body is not the documented shape", async () => {
    const fetch = fetchReturning(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await relayWithdraw({ baseUrl: "https://showmark.example", fetch }, { token: zeroAddress, account: alice }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "RELAY", status: 502, apiCode: "HTTP_502", action: "Try again in a few seconds." });
  });

  it("reports unreachable relayers and malformed success bodies as ShowmarkNetworkError", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(relayCheckIn({ baseUrl: "https://showmark.example", fetch: offline }, data)).rejects.toBeInstanceOf(ShowmarkNetworkError);
    const weird = fetchReturning(Response.json({ ok: true }));
    await expect(relayCheckIn({ baseUrl: "https://showmark.example", fetch: weird }, data)).rejects.toBeInstanceOf(ShowmarkNetworkError);
    const notJson = fetchReturning(new Response("ok", { status: 200 }));
    await expect(relayCheckIn({ baseUrl: "https://showmark.example", fetch: notJson }, data)).rejects.toBeInstanceOf(ShowmarkNetworkError);
  });

  it("validates input and configuration before sending anything", async () => {
    const fetch = fetchReturning();
    const options = { baseUrl: "https://showmark.example", fetch };
    await expect(relayCheckIn({ baseUrl: "ftp://showmark.example", fetch }, data)).rejects.toBeInstanceOf(ShowmarkConfigError);
    await expect(relayCheckIn({ baseUrl: "not a url", fetch }, data)).rejects.toBeInstanceOf(ShowmarkConfigError);
    await expect(relayCheckIn(options, { ...data, mode: 3 as 1 })).rejects.toBeInstanceOf(ShowmarkInputError);
    await expect(relayCheckIn(options, { ...data, attendee: "0x12" })).rejects.toBeInstanceOf(ShowmarkInputError);
    await expect(relayCheckInBatch(options, [])).rejects.toBeInstanceOf(ShowmarkInputError);
    await expect(relayCheckInBatch(options, Array.from({ length: 51 }, () => data))).rejects.toBeInstanceOf(ShowmarkInputError);
    await expect(getTxStatus(options, "0x12")).rejects.toBeInstanceOf(ShowmarkInputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("transaction status", () => {
  it("parses the block number and polls until the transaction is mined", async () => {
    const fetch = fetchReturning(
      Response.json({ status: "pending" }),
      Response.json({ status: "pending" }),
      Response.json({ status: "success", blockNumber: "123456" }),
    );
    const status = await waitForTx({ baseUrl: "https://showmark.example", fetch }, txHash, { intervalMs: 1 });
    expect(status).toEqual({ status: "success", blockNumber: 123456n });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://showmark.example/api/tx/${txHash}`);
  });

  it("gives up after the timeout", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "pending" }));
    await expect(waitForTx({ baseUrl: "https://showmark.example", fetch }, txHash, { intervalMs: 5, timeoutMs: 12 })).rejects.toBeInstanceOf(
      ShowmarkNetworkError,
    );
  });

  it("stops when aborted", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "pending" }));
    const controller = new AbortController();
    const waiting = waitForTx({ baseUrl: "https://showmark.example", fetch }, txHash, { intervalMs: 1_000, signal: controller.signal });
    controller.abort(new Error("unmounted"));
    await expect(waiting).rejects.toThrow("unmounted");
  });
});

describe("splitPayout", () => {
  it("matches the vault formula to the wei", () => {
    expect(splitPayout(1_000_000n, 200, 5000)).toEqual({ gross: 1_000_000n, fee: 20_000n, toAttendee: 490_000n, toOrganizer: 490_000n });
    expect(splitPayout(7n, 500, 3333)).toEqual({ gross: 7n, fee: 0n, toAttendee: 2n, toOrganizer: 5n });
    expect(() => splitPayout(1n, 10_001, 0)).toThrow(ShowmarkInputError);
  });
});
