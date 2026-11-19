import { describe, expect, it } from "vitest";
import type { ApiResult, TxState } from "./api";
import { raceTxStatus } from "./tx-race";

const never = <T,>() => new Promise<T>(() => undefined);
const later = <T,>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const api = (status: TxState["status"]): ApiResult<TxState> => ({ ok: true, data: { status } });

describe("raceTxStatus", () => {
  it("takes a mined receipt from the chain without waiting for a hung API", async () => {
    await expect(raceTxStatus(Promise.resolve({ status: "success", blockNumber: "9" }), never())).resolves.toEqual({ ok: true, data: { status: "success", blockNumber: "9" } });
  });

  it("takes a mined answer from the API when the chain is slower", async () => {
    await expect(raceTxStatus(later({ status: "pending" }, 50), Promise.resolve(api("success")))).resolves.toEqual(api("success"));
  });

  it("answers pending from the chain alone when the API hangs", async () => {
    await expect(raceTxStatus(Promise.resolve({ status: "pending" }), never())).resolves.toEqual({ ok: true, data: { status: "pending" } });
  });

  it("falls back to the API when the chain cannot be read", async () => {
    await expect(raceTxStatus(Promise.resolve(null), Promise.resolve(api("pending")))).resolves.toEqual(api("pending"));
    await expect(raceTxStatus(Promise.reject(new Error("rpc")), Promise.resolve(api("success")))).resolves.toEqual(api("success"));
  });
});
