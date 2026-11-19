import type { ApiResult, TxState } from "./api";

/**
 * Transaction status from two sources at once: the chain's own receipt (null when the RPC cannot
 * answer) and our /api/tx route. A mined answer from either wins at once. A "pending" from the chain
 * is answer enough for one poll, so a slow API never stretches a poll; the API matters when the
 * chain cannot be read.
 */
export function raceTxStatus(chain: Promise<TxState | null>, api: Promise<ApiResult<TxState>>): Promise<ApiResult<TxState>> {
  return new Promise((resolve) => {
    let chainAnswered = false;
    let chainFailed = false;
    let apiResult: ApiResult<TxState> | null = null;
    const chainUnreadable = () => {
      chainFailed = true;
      if (apiResult) resolve(apiResult);
    };

    chain.then((state) => {
      if (!state) return chainUnreadable();
      chainAnswered = true;
      resolve({ ok: true, data: state });
    }, chainUnreadable);
    api.then((result) => {
      apiResult = result;
      if (result.ok && result.data.status !== "pending") resolve(result);
      else if (chainFailed || chainAnswered) resolve(result);
    });
  });
}
