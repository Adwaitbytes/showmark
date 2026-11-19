import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  InsufficientFundsError,
  isHex,
  UserRejectedRequestError,
} from "viem";
import { vaultAbi } from "@/lib/chain/abi";

/** What happened and what to do next. Never a raw revert string. */
export interface PlainError {
  message: string;
  action: string;
}

const REVERTS: Record<string, PlainError> = {
  InvalidParams: {
    message: "The vault rejected these campaign settings.",
    action: "Check that the end is after the start and the amount is above zero, then try again.",
  },
  MetadataTooLong: {
    message: "The name, sponsor and description are too long for the vault.",
    action: "Shorten the description and try again.",
  },
  BadDeposit: {
    message: "The deposit did not match what the wallet sent.",
    action: "Reload the page and try again.",
  },
  NotSponsor: {
    message: "Only the wallet that created this campaign can do that.",
    action: "Switch QIE Wallet to the sponsor account and try again.",
  },
  UnknownEvent: {
    message: "That event does not exist on this network.",
    action: "Check the event id and try again.",
  },
  CampaignEnded: {
    message: "This campaign has ended, so it cannot take more funds.",
    action: "Create a new campaign instead.",
  },
  RefundNotYetAvailable: {
    message: "The refund is not open yet.",
    action: "Wait until the date shown, so late check-ins can still be paid, then try again.",
  },
  NothingToPay: {
    message: "There is nothing left in this campaign to refund.",
    action: "No action is needed.",
  },
  UnknownCampaign: {
    message: "This campaign does not exist on this network.",
    action: "Check the link and try again.",
  },
  EnforcedPause: {
    message: "Showmark has paused new campaigns and top ups for now.",
    action: "Try again later. Refunds and withdrawals keep working while paused.",
  },
  SafeERC20FailedOperation: {
    message: "The QUSDC transfer into the vault failed.",
    action: "Check your QUSDC balance and approval, then try again.",
  },
  ERC20InsufficientAllowance: {
    message: "The vault is not approved to take this much QUSDC.",
    action: "Approve the deposit amount first, then try again.",
  },
  ERC20InsufficientBalance: {
    message: "This wallet does not hold enough QUSDC for the deposit.",
    action: "Add QUSDC to the wallet or lower the deposit.",
  },
};

const REJECTED: PlainError = {
  message: "You declined the request in your wallet.",
  action: "Nothing was sent. Try again when you are ready.",
};

const NO_GAS: PlainError = {
  message: "This wallet does not have enough QIE for the deposit and the network fee.",
  action: "Add QIE to the wallet or lower the deposit, then try again.",
};

const UNKNOWN: PlainError = {
  message: "The transaction did not go through.",
  action: "Nothing was charged except possibly the network fee. Reload the page and try again.",
};

function rpcCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

function revertName(data: `0x${string}`): string | null {
  try {
    return decodeErrorResult({ abi: vaultAbi, data }).errorName;
  } catch {
    // Not one of the vault's errors; the caller falls back to generic copy.
    return null;
  }
}

/** Turns anything a wallet, viem or the vault throws into plain copy for the person at the keyboard. */
export function toPlainError(error: unknown): PlainError {
  if (rpcCode(error) === 4001) return REJECTED;
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return REJECTED;
    if (error.walk((e) => e instanceof InsufficientFundsError)) return NO_GAS;
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && REVERTS[name]) return REVERTS[name];
    }
    const raw = error.walk((e) => typeof e === "object" && e !== null && "data" in e && isHex((e as { data: unknown }).data));
    const data = raw && "data" in raw ? (raw as { data: unknown }).data : null;
    if (isHex(data) && data.length >= 10) {
      const name = revertName(data);
      if (name && REVERTS[name]) return REVERTS[name];
    }
    if (rpcCode(error.walk()) === 4001) return REJECTED;
  }
  return UNKNOWN;
}
