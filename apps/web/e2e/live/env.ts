import { readFileSync } from "node:fs";
import path from "node:path";
import { getAddress, isHex, type Address, type Hex } from "viem";

/** Repo root, resolved from this file so the harness runs from any working directory. */
export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const BASE_URL = process.env.LIVE_BASE_URL ?? "https://showmark.vercel.app";
export const CHAIN_ID = 1983;
export const CHAIN_HEX = "0x7bf";
export const RPC_URL = "https://rpc1testnet.qie.digital";
export const EXPLORER = "https://testnet.qie.digital";
export const QA_DIR = path.join(REPO_ROOT, "docs/qa/live");

interface Deployment {
  registry: Address;
  vault: Address;
  stamp: Address;
  chainId: number;
}

export const deployment: Deployment = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/contracts/deployments/1983.json"), "utf8"));
if (deployment.chainId !== CHAIN_ID) throw new Error(`deployments/1983.json says chain ${deployment.chainId}`);

/**
 * The throwaway testnet key, read from .env.local and never logged. Parsing by hand keeps the rest of .env.local
 * (which also holds production secrets) out of process.env.
 */
function readTestWallet(): { key: Hex; address: Address } {
  const text = readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8");
  const value = (name: string): string | null => {
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line
      ? line
          .slice(name.length + 1)
          .trim()
          .replace(/^["']|["']$/g, "")
      : null;
  };
  const key = value("TESTNET_E2E_WALLET_KEY");
  const address = value("TESTNET_E2E_WALLET_ADDRESS");
  if (!key || !address) throw new Error("TESTNET_E2E_WALLET_KEY and TESTNET_E2E_WALLET_ADDRESS must be set in .env.local");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!isHex(normalized) || normalized.length !== 66) throw new Error("TESTNET_E2E_WALLET_KEY is not a 32-byte hex key");
  return { key: normalized, address: getAddress(address) };
}

export const testWallet = readTestWallet();
