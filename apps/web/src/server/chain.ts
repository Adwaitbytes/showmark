import { zeroAddress, type Address, type PublicClient } from "viem";
import { addresses, deployBlock } from "@/lib/chain/addresses";
import { activeChainId } from "@/lib/chain/chains";
import { publicClient } from "@/lib/chain/clients";
import { qieNameRegistryAddress } from "./env";

/** Mainnet QIE ID root registry (ERC1967 proxy). Registered as a minter on Zone; holds `userDomain(address)`. */
export const MAINNET_QIE_NAME_REGISTRY: Address = "0x1D69d75AD7b77b91C3760F84faC52E651710f62e";

/**
 * Everything server code needs to talk to one chain. Production uses the shared config from src/lib/chain;
 * the integration test builds one against a local anvil node instead.
 */
export interface ChainContext {
  chainId: number;
  client: PublicClient;
  registry: Address;
  vault: Address;
  zone: Address;
  qusdc: Address;
  oracle: Address;
  /** QIE ID root registry for reverse lookups, or zero when the network has none. */
  nameRegistry: Address;
  deployBlock: bigint;
}

let override: ChainContext | null = null;

export function chainContext(): ChainContext {
  if (override) return override;
  return {
    chainId: activeChainId,
    client: publicClient,
    registry: addresses.registry,
    vault: addresses.vault,
    zone: addresses.zone,
    qusdc: addresses.qusdc,
    oracle: addresses.qieUsdOracle,
    nameRegistry: qieNameRegistryAddress() ?? (activeChainId === 1990 ? MAINNET_QIE_NAME_REGISTRY : zeroAddress),
    deployBlock,
  };
}

export function setChainContext(ctx: ChainContext | null): void {
  override = ctx;
}

export function contractsDeployed(ctx: ChainContext): boolean {
  return ctx.registry !== zeroAddress && ctx.vault !== zeroAddress;
}
