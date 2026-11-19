import { isAddress, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from "viem";
import { vaultAbi } from "./abi";
import { ShowmarkInputError } from "./errors";

// Organizer actions on open campaigns. A campaign open to bonded organizers pays only those who opted in, so an
// organizer chooses which sponsors appear next to their events. These send a transaction from the organizer's wallet.

export interface OpenCampaignParams {
  walletClient: WalletClient<Transport, Chain | undefined, Account>;
  /** CampaignVault address. */
  vault: Address;
  campaignId: bigint;
}

function check(params: OpenCampaignParams): void {
  if (!isAddress(params.vault)) throw new ShowmarkInputError(`vault is not a valid address or its checksum is wrong: ${params.vault}`);
  if (params.campaignId <= 0n) throw new ShowmarkInputError("campaignId must be positive");
}

/** Opts the wallet's organizer into an open campaign. Resolves with the transaction hash. */
export async function optInOpenCampaign(params: OpenCampaignParams): Promise<Hex> {
  check(params);
  return params.walletClient.writeContract({
    address: params.vault,
    abi: vaultAbi,
    functionName: "optInOpenCampaign",
    args: [params.campaignId],
    account: params.walletClient.account,
    chain: params.walletClient.chain,
  });
}

/** Opts the wallet's organizer out again. Payouts already settled stand. Resolves with the transaction hash. */
export async function optOutOpenCampaign(params: OpenCampaignParams): Promise<Hex> {
  check(params);
  return params.walletClient.writeContract({
    address: params.vault,
    abi: vaultAbi,
    functionName: "optOutOpenCampaign",
    args: [params.campaignId],
    account: params.walletClient.account,
    chain: params.walletClient.chain,
  });
}
