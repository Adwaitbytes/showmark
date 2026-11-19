import { zeroAddress, type Address, type PublicClient } from "viem";
import { addresses, deployBlock } from "@/lib/chain/addresses";
import { activeChainId } from "@/lib/chain/chains";
import { publicClient } from "@/lib/chain/clients";
import { qieNameRegistryAddress } from "./env";

/** Mainnet QIE ID root registry (ERC1967 proxy): `userDomain(address)` and `resolver(fqn)`. */
export const MAINNET_QIE_NAME_REGISTRY: Address = "0x1D69d75AD7b77b91C3760F84faC52E651710f62e";
/** Mainnet paid QIE ID registry: `resolver(fqn)` only. */
export const MAINNET_QIE_PAID_NAME_REGISTRY: Address = "0x26cCB3fABd6db18834987134d715Ba2346CE7223";

/**
 * Everything server code needs to talk to one chain. Production uses the shared config from src/lib/chain;
 * the integration test builds one against a local anvil node instead.
 */
export interface ChainContext {
  chainId: number;
  client: PublicClient;
  registry: Address;
  vault: Address;
  /** OrganizerBond, or zero when not configured. */
  bond: Address;
  qusdc: Address;
  oracle: Address;
  /** QIE ID root registry (names and the QIE ID test), or zero when the network has none. */
  nameRegistry: Address;
  /** Paid QIE ID registry for forward lookups, or zero. */
  paidNameRegistry: Address;
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
    bond: addresses.bond,
    qusdc: addresses.qusdc,
    oracle: addresses.qieUsdOracle,
    nameRegistry: qieNameRegistryAddress() ?? (activeChainId === 1990 ? MAINNET_QIE_NAME_REGISTRY : zeroAddress),
    paidNameRegistry: activeChainId === 1990 ? MAINNET_QIE_PAID_NAME_REGISTRY : zeroAddress,
    deployBlock,
  };
}

export function setChainContext(ctx: ChainContext | null): void {
  override = ctx;
}

/** The contracts whose logs the indexer reads: registry and vault, plus the bond when it is configured. */
export function indexedContracts(ctx: ChainContext): Address[] {
  return ctx.bond === zeroAddress ? [ctx.registry, ctx.vault] : [ctx.registry, ctx.vault, ctx.bond];
}

export function contractsDeployed(ctx: ChainContext): boolean {
  return ctx.registry !== zeroAddress && ctx.vault !== zeroAddress;
}
