import type { Address } from "viem";
import type { SupportedChainId } from "./chains";

/** Contract addresses for one Showmark deployment. */
export interface ShowmarkAddresses {
  registry: Address;
  vault: Address;
  /** PresenceLens, the IPresence implementation. Needed for attendedCount and wallet-aware streaks. */
  lens: Address;
  stamp: Address;
  bond: Address;
}

/**
 * Official deployments, filled in by `pnpm sync-abi` from packages/contracts/deployments/{chainId}.json once the
 * contracts are deployed. Until then pass addresses to ShowmarkClient yourself.
 */
export const showmarkDeployments: Partial<Record<SupportedChainId, ShowmarkAddresses>> = {};
