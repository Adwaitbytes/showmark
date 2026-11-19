import { BaseError, ContractFunctionRevertedError, encodeFunctionData, getAddress, type Hex } from "viem";
import { bondAbi, registryAbi, vaultAbi } from "@/lib/chain/abi";
import { AppError, COMMON_ERRORS, RELAY_ERRORS } from "../errors";
import { waitForLock } from "../lock";
import { log } from "../log";
import type { LinkWalletRequest } from "../schemas";
import { followUpRefreshes, relayLockKey, type RelayerDeps } from "./queue";
import { refreshClaimRequest } from "./claims";
import { sendSequential, type TxRequest } from "./sender";
import { settleRequests, type SettleItem } from "./settle";

// Single relayed actions that do not go through the check-in queue: linking a pass to a wallet and withdrawing a
// claimable balance. Both are simulated first, then sent under the same nonce lock as check-ins.

const LOCK_WAIT_MS = 10_000;

function revertName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.reason ?? "reverted") : null;
}

async function sendUnderLock(deps: RelayerDeps, requests: TxRequest[]): Promise<Hex> {
  const lock = await waitForLock(deps.kv, relayLockKey(deps.chain), deps.options.lockTtlMs, LOCK_WAIT_MS);
  if (!lock) throw new AppError(503, { code: "relayer_busy", message: "The relayer is busy sending other transactions.", action: "Try again in a few seconds." });
  try {
    const { sent, error } = await sendSequential(deps.chain, deps.kv, lock, requests, deps.now);
    if (!sent[0]) throw new AppError(502, RELAY_ERRORS.sendFailed, { cause: error });
    if (error) log.warn("relayer.follow_up_not_sent", { first: sent[0].hash, error });
    return sent[0].hash;
  } finally {
    await lock.release();
  }
}

/**
 * Links a guest pass to a wallet. Rewards that waited for a QIE ID are settled in the same lock, right behind the
 * link with the next nonce, so a newly linked QIE ID holder is paid in the same block.
 */
export async function relayLinkWallet(deps: RelayerDeps, req: LinkWalletRequest, waitingForQieId: SettleItem[]): Promise<Hex> {
  const { chain } = deps;
  const args = [req.pass, req.wallet, req.deadline, req.passSig, req.walletSig, req.relocateEventIds] as const;
  let gas: bigint;
  try {
    await chain.client.simulateContract({ address: chain.registry, abi: registryAbi, functionName: "linkWallet", args, account: chain.account.address });
    gas = await chain.client.estimateContractGas({ address: chain.registry, abi: registryAbi, functionName: "linkWallet", args, account: chain.account.address });
  } catch (error) {
    const reason = revertName(error);
    if (reason) {
      log.info("relayer.link_rejected", { pass: req.pass, wallet: req.wallet, reason });
      throw new AppError(422, RELAY_ERRORS.linkRejected, { cause: error });
    }
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  const link: TxRequest = {
    to: chain.registry,
    data: encodeFunctionData({ abi: registryAbi, functionName: "linkWallet", args }),
    gas: (gas * 125n) / 100n + 20_000n,
    label: "linkWallet",
  };
  return sendUnderLock(deps, [link, ...settleRequests(chain, waitingForQieId), ...(await followUpRefreshes(deps, waitingForQieId))]);
}

/** Pays out `claimable[token][account]` to the account's linked wallet (or the account). The relayer pays gas. */
export async function relayWithdraw(deps: RelayerDeps, token: Hex, account: Hex): Promise<Hex> {
  const { chain } = deps;
  const args = [getAddress(token), getAddress(account)] as const;
  let gas: bigint;
  try {
    const owed = await chain.client.readContract({ address: chain.vault, abi: vaultAbi, functionName: "claimable", args });
    if (owed === 0n) throw new AppError(422, RELAY_ERRORS.nothingToWithdraw);
    await chain.client.simulateContract({ address: chain.vault, abi: vaultAbi, functionName: "withdraw", args, account: chain.account.address });
    gas = await chain.client.estimateContractGas({ address: chain.vault, abi: vaultAbi, functionName: "withdraw", args, account: chain.account.address });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (revertName(error)) throw new AppError(422, RELAY_ERRORS.withdrawRejected, { cause: error });
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  return sendUnderLock(deps, [
    { to: chain.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args }), gas: (gas * 125n) / 100n + 20_000n, label: "withdraw" },
  ]);
}

/** Settles items the cron found unpaid. Simulated first so a batch that would revert is never sent. */
export async function relaySettlements(deps: RelayerDeps, items: SettleItem[]): Promise<Hex | null> {
  if (items.length === 0) return null;
  const { chain } = deps;
  try {
    await chain.client.simulateContract({ address: chain.vault, abi: vaultAbi, functionName: "settleBatch", args: [items.slice(0, 100)], account: chain.account.address });
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  return sendUnderLock(deps, [...settleRequests(chain, items), ...(await followUpRefreshes(deps, items))]);
}

/** Cron sweep (audit I4-01): raises every open claim that sits below the live bonded exposure. */
export async function relayClaimRefreshes(deps: RelayerDeps, challengeIds: bigint[]): Promise<Hex | null> {
  if (challengeIds.length === 0) return null;
  const { chain } = deps;
  try {
    for (const id of challengeIds) {
      await chain.client.simulateContract({ address: chain.bond, abi: bondAbi, functionName: "refreshClaim", args: [id], account: chain.account.address });
    }
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  return sendUnderLock(deps, challengeIds.map((id) => refreshClaimRequest(chain, id)));
}
