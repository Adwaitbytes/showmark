import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  formatEther,
  isHex,
  InsufficientFundsError,
  parseAbi,
  UserRejectedRequestError,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { registryAbi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { activeChain } from "@/lib/chain/chains";
import { publicClient } from "@/lib/chain/clients";
import { walletClient } from "@/lib/wallet/use-wallet";
import type { ErrorCopy } from "./api";

// Organizer transactions are sent from the organizer's own wallet, which pays a small gas fee. Everything here turns
// the wallet's and the chain's answers into words: what it costs before sending, and what went wrong after.

// The shared ABI lists functions and events only. These are the registry's custom errors, so a revert decodes to a
// name we can explain instead of a raw selector. Signatures match IShowmarkRegistry.sol.
const registryErrorsAbi = parseAbi([
  "error UnknownEvent()",
  "error UnknownSeries()",
  "error NotOrganizer()",
  "error NotSeriesOrganizer()",
  "error InvalidEventWindow()",
  "error InvalidMaxPassAge()",
  "error MetadataTooLong()",
  "error CapacityBelowCheckedIn()",
  "error InvalidDoorKey()",
  "error ValidUntilTooLate()",
  "error EnforcedPause()",
]);

export type RegistryCall =
  | { functionName: "createSeries"; args: readonly [string] }
  | { functionName: "createEvent"; args: readonly [bigint, bigint, number, number, bigint, string] }
  | { functionName: "updateEventMetadata"; args: readonly [bigint, string] }
  | { functionName: "setCapacity"; args: readonly [bigint, number] }
  | { functionName: "authorizeDoorKey"; args: readonly [bigint, Address, bigint] }
  | { functionName: "revokeDoorKey"; args: readonly [bigint, Address] };

/** Calldata for one registry call. One branch per function keeps every argument list fully typed. */
export function encodeRegistryCall(call: RegistryCall): Hex {
  switch (call.functionName) {
    case "createSeries":
      return encodeFunctionData({ abi: registryAbi, functionName: call.functionName, args: call.args });
    case "createEvent":
      return encodeFunctionData({ abi: registryAbi, functionName: call.functionName, args: call.args });
    case "updateEventMetadata":
      return encodeFunctionData({ abi: registryAbi, functionName: call.functionName, args: call.args });
    case "setCapacity":
      return encodeFunctionData({ abi: registryAbi, functionName: call.functionName, args: call.args });
    case "authorizeDoorKey":
      return encodeFunctionData({ abi: registryAbi, functionName: call.functionName, args: call.args });
    case "revokeDoorKey":
      return encodeFunctionData({ abi: registryAbi, functionName: call.functionName, args: call.args });
  }
}

/** The registry error name inside a failed estimate or call, if the node returned revert data. */
function revertName(error: BaseError): string | null {
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? null;
  const withData = error.walk((e) => {
    const data = (e as { data?: unknown }).data;
    return typeof data === "string" && isHex(data) && data.length >= 10;
  });
  const data = (withData as { data?: unknown } | null)?.data;
  if (typeof data !== "string" || !isHex(data)) return null;
  try {
    return decodeErrorResult({ abi: registryErrorsAbi, data }).errorName;
  } catch {
    return null;
  }
}

export interface GasQuote {
  gas: bigint;
  gasPrice: bigint;
  /** gas times gas price, in wei. */
  cost: bigint;
  balance: bigint;
  enough: boolean;
}

/** Error copy, plus the gas cost when the problem is an empty wallet. */
export type TxErrorCopy = ErrorCopy & { needsGas?: boolean; gasCost?: string };

export class TxError extends Error {
  constructor(readonly copy: TxErrorCopy) {
    super(copy.message);
    this.name = "TxError";
  }
}

const REVERT_COPY: Record<string, ErrorCopy> = {
  UnknownEvent: { code: "unknown_event", message: "This event does not exist on the registry.", action: "Check the event number in the link." },
  UnknownSeries: { code: "unknown_series", message: "That series does not exist.", action: "Pick another series, or start a new one." },
  NotOrganizer: {
    code: "not_organizer",
    message: "The connected wallet is not the organizer of this event.",
    action: "Switch QIE Wallet to the account that created the event, then try again.",
  },
  NotSeriesOrganizer: {
    code: "not_series_organizer",
    message: "That series belongs to another wallet.",
    action: "Pick one of your own series, or start a new one.",
  },
  InvalidEventWindow: { code: "invalid_window", message: "The event ends before it starts.", action: "Set an end time after the start time." },
  InvalidMaxPassAge: {
    code: "invalid_pass_age",
    message: "The door code lifetime must be between 30 and 600 seconds.",
    action: "Pick a value in that range.",
  },
  MetadataTooLong: {
    code: "metadata_too_long",
    message: "The event details are longer than the 2,048 bytes the chain accepts.",
    action: "Shorten the description, then try again.",
  },
  CapacityBelowCheckedIn: {
    code: "capacity_below_checked_in",
    message: "The new capacity is lower than the number of people already checked in.",
    action: "Set a capacity at least as high as the current count, or 0 for no limit.",
  },
  InvalidDoorKey: { code: "invalid_door_key", message: "This door key is not valid.", action: "Reset this door device and open the door screen again." },
  ValidUntilTooLate: {
    code: "valid_until_too_late",
    message: "The door key would outlive the event by more than three days.",
    action: "Reload the door screen and authorize again.",
  },
  EnforcedPause: {
    code: "paused",
    message: "Showmark has paused new events and check-ins for safety.",
    action: "Try again in a few minutes.",
  },
};

export function needsGasCopy(account: Address, cost: bigint | null): TxErrorCopy {
  const amount = cost === null ? "a small amount of QIE" : `about ${formatQie(cost)} QIE`;
  const where = activeChain.testnet
    ? "Get free test QIE from the faucet at qie.digital/faucet, then try again."
    : `Send a little QIE to ${account} from an exchange or another wallet, then try again.`;
  return {
    code: "needs_gas",
    message: `You need a little QIE for gas. This step costs ${amount}.`,
    action: where,
    needsGas: true,
    ...(cost === null ? {} : { gasCost: formatQie(cost) }),
  };
}

/** Turns a wallet, RPC or revert error into what happened and what to do next. */
export function describeTxError(error: unknown, account: Address | null): TxErrorCopy {
  if (error instanceof TxError) return error.copy;
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { code: "rejected", message: "You declined the transaction in QIE Wallet.", action: "Try again and approve it in QIE Wallet." };
    }
    if (error.walk((e) => e instanceof InsufficientFundsError) && account) return needsGasCopy(account, null);
    const name = revertName(error);
    if (name && REVERT_COPY[name]) return REVERT_COPY[name];
    if (name || error.walk((e) => e instanceof ContractFunctionRevertedError)) {
      return { code: "reverted", message: "The registry refused this transaction.", action: "Check the details and try again. Nothing was charged." };
    }
  }
  if (code === 4001) {
    return { code: "rejected", message: "You declined the transaction in QIE Wallet.", action: "Try again and approve it in QIE Wallet." };
  }
  return {
    code: "tx_failed",
    message: "The transaction could not be sent.",
    action: "Check that QIE Wallet is unlocked and on the right network, then try again.",
  };
}

/** "0.000225", "1.25": a QIE amount with three significant digits below 1, four decimals above, no trailing zeros. */
export function formatQie(wei: bigint): string {
  // Below a millionth of a QIE the exact figure means nothing to a person (testnet gas is a few wei).
  if (wei > 0n && wei < 10n ** 12n) return "<0.000001";
  const text = formatEther(wei);
  const [whole, fraction = ""] = text.split(".");
  if (!fraction) return whole;
  const firstSignificant = fraction.search(/[1-9]/);
  const keep = whole !== "0" ? 4 : Math.max(firstSignificant + 3, 4);
  const trimmed = fraction.slice(0, keep).replace(/0+$/, "");
  if (!trimmed) return whole === "0" ? `<0.${"0".repeat(keep - 1)}1` : whole;
  return `${whole}.${trimmed}`;
}

/** Estimates what a registry call costs the connected wallet, before asking it to sign anything. */
export async function quoteRegistryCall(call: RegistryCall, account: Address): Promise<GasQuote> {
  try {
    const [gas, gasPrice, balance] = await Promise.all([
      publicClient.estimateGas({ account, to: addresses.registry, data: encodeRegistryCall(call) }),
      publicClient.getGasPrice(),
      publicClient.getBalance({ address: account }),
    ]);
    const cost = gas * gasPrice;
    return { gas, gasPrice, cost, balance, enough: balance >= cost };
  } catch (error) {
    throw new TxError(describeTxError(error, account));
  }
}

/** Sends a registry call from the connected wallet and waits for it to be mined. */
export async function sendRegistryCall(
  call: RegistryCall,
  account: Address,
  onSubmitted?: (hash: Hex) => void,
): Promise<TransactionReceipt> {
  const client = walletClient();
  if (!client) {
    throw new TxError({ code: "no_wallet", message: "QIE Wallet is not connected.", action: "Connect QIE Wallet and try again." });
  }
  let hash: Hex;
  try {
    const quote = await quoteRegistryCall(call, account);
    if (!quote.enough) throw new TxError(needsGasCopy(account, quote.cost));
    hash = await client.sendTransaction({
      account,
      chain: activeChain,
      to: addresses.registry,
      data: encodeRegistryCall(call),
      // A quarter on top of the estimate: QIE estimates are exact, but a busy block can shift storage costs.
      gas: (quote.gas * 125n) / 100n,
    });
  } catch (error) {
    throw new TxError(describeTxError(error, account));
  }
  onSubmitted?.(hash);
  let receipt: TransactionReceipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  } catch {
    throw new TxError({
      code: "receipt_timeout",
      message: "The transaction was sent but has not shown up on the chain yet.",
      action: "Open it on the explorer to check, then reload this page.",
    });
  }
  if (receipt.status !== "success") {
    throw new TxError({ code: "reverted", message: "The transaction was mined but the registry refused it.", action: "Open it on the explorer, then try again." });
  }
  return receipt;
}
