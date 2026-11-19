import { parseAbi } from "viem";

// Public getters and custom errors of CampaignVault that the shared vaultAbi (src/lib/chain/abi.ts) does not list.
// Copied from packages/contracts/src/CampaignVault.sol and ICampaignVault.sol. Reported to the lead so they can
// move into the shared ABI; until then the sponsor console reads them through this fragment.
export const vaultSponsorAbi = parseAbi([
  "struct Campaign { address sponsor; uint8 pricing; uint16 attendeeShareBps; uint16 feeBps; uint8 minProofMode; bool requireQieId; bool openToBonded; address token; uint32 maxPerEvent; uint32 maxTotal; uint32 settledCount; uint64 startsAt; uint64 endsAt; uint128 amountPerPresence; uint128 minBond; uint256 balance; }",
  "function campaign(uint256 id) view returns (Campaign)",
  "function feeBps() view returns (uint16)",
  "function maxOracleAge() view returns (uint256)",
  "error ZeroAddress()",
  "error InvalidParams()",
  "error MetadataTooLong()",
  "error BadDeposit()",
  "error NotSponsor()",
  "error UnknownEvent(uint256 eventId)",
  "error CampaignEnded()",
  "error RefundNotYetAvailable()",
  "error NothingToPay()",
  "error UnknownCampaign()",
  "error EnforcedPause()",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
]);
