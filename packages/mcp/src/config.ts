import { ShowmarkClient, isSupportedChainId, showmarkChains, type ShowmarkAddresses } from "@showmark/sdk";
import { getAddress, isAddress, type Address } from "viem";
import { httpDataSource } from "./data";
import type { ShowmarkMcpOptions } from "./server";

/** Settings the standalone server reads from the environment. Every one is optional. */
export interface ShowmarkMcpEnv {
  /** Showmark site for indexed data, for example https://showmark.app. */
  SHOWMARK_API_URL?: string | undefined;
  /** 1990 for mainnet (default) or 1983 for testnet. */
  SHOWMARK_CHAIN_ID?: string | undefined;
  /** Comma-separated RPC endpoints. Defaults to the public QIE endpoints with failover. */
  SHOWMARK_RPC_URL?: string | undefined;
  SHOWMARK_REGISTRY_ADDRESS?: string | undefined;
  SHOWMARK_VAULT_ADDRESS?: string | undefined;
  SHOWMARK_LENS_ADDRESS?: string | undefined;
}

export class ShowmarkConfigProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShowmarkConfigProblem";
  }
}

function optionalAddress(name: string, value: string | undefined): Address | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (!isAddress(value.trim())) throw new ShowmarkConfigProblem(`${name} is not a valid address or its checksum is wrong: ${value}`);
  return getAddress(value.trim());
}

/** Validates the environment and builds the options for createShowmarkMcpServer. Throws ShowmarkConfigProblem. */
export function optionsFromEnv(env: ShowmarkMcpEnv): ShowmarkMcpOptions {
  const chainId = Number(env.SHOWMARK_CHAIN_ID?.trim() || "1990");
  if (!isSupportedChainId(chainId)) throw new ShowmarkConfigProblem(`SHOWMARK_CHAIN_ID must be 1990 or 1983, got ${env.SHOWMARK_CHAIN_ID}`);
  const chain = showmarkChains[chainId];

  const addresses: Partial<ShowmarkAddresses> = {};
  const registry = optionalAddress("SHOWMARK_REGISTRY_ADDRESS", env.SHOWMARK_REGISTRY_ADDRESS);
  const vault = optionalAddress("SHOWMARK_VAULT_ADDRESS", env.SHOWMARK_VAULT_ADDRESS);
  const lens = optionalAddress("SHOWMARK_LENS_ADDRESS", env.SHOWMARK_LENS_ADDRESS);
  if (registry) addresses.registry = registry;
  if (vault) addresses.vault = vault;
  if (lens) addresses.lens = lens;

  const rpcUrls = env.SHOWMARK_RPC_URL?.split(",").map((u) => u.trim()).filter((u) => u.length > 0);
  for (const url of rpcUrls ?? []) {
    if (!/^https?:\/\//.test(url)) throw new ShowmarkConfigProblem(`SHOWMARK_RPC_URL must hold http or https URLs, got ${url}`);
  }
  const client = new ShowmarkClient({ chain: chainId, addresses, ...(rpcUrls && rpcUrls.length > 0 ? { rpcUrls } : {}) });

  const apiUrl = env.SHOWMARK_API_URL?.trim();
  return { chain, client, ...(apiUrl ? { data: httpDataSource({ apiUrl }) } : {}) };
}
