import { parseAbi } from "viem";

// Showmark contract ABIs are generated from the Foundry build (see generated-abi.ts); external token and oracle ABIs live here.
export { registryAbi, vaultAbi, bondAbi, lensAbi, stampAbi, qieIdCheckAbi } from "./generated-abi";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export const CHECK_IN_STATUS = [
  "Recorded",
  "AlreadyPresent",
  "UnknownEvent",
  "BadAttendeeSig",
  "BadDoorSig",
  "DoorKeyNotAuthorized",
  "Stale",
  "OutsideEventWindow",
  "AtCapacity",
  "BadMode",
  "Paused",
] as const;

export const SETTLE_STATUS = [
  "Settled",
  "AlreadySettled",
  "UnknownCampaign",
  "NotPresent",
  "OutsideCampaignWindow",
  "EventNotEligible",
  "EventCapReached",
  "TotalCapReached",
  "NeedsQieId",
  "PriceStale",
  "InsufficientBudget",
  "SettlementClosed",
  "Paused",
] as const;
