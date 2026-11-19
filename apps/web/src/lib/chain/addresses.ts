import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { activeChainId } from "./chains";

function addr(name: string, raw: string | undefined, fallback?: Address): Address {
  if (raw && isAddress(raw)) return getAddress(raw);
  if (fallback) return fallback;
  // Unset addresses resolve to zero so pages can render a clear "not deployed yet" state instead of crashing.
  if (raw) throw new Error(`${name} is not a valid address: ${raw}`);
  return zeroAddress;
}

const MAINNET_EXTERNAL = {
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  qieNameRegistry: "0x1D69d75AD7b77b91C3760F84faC52E651710f62e",
  qieUsdOracle: "0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17",
  dexRouter: "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef",
  wqie: "0x0087904D95BEe9E5F24dc8852804b547981A9139",
} as const satisfies Record<string, Address>;

const isMainnet = activeChainId === 1990;

// NEXT_PUBLIC_* must be referenced literally so Next.js inlines them into client bundles.
export const addresses = {
  registry: addr("NEXT_PUBLIC_REGISTRY_ADDRESS", process.env.NEXT_PUBLIC_REGISTRY_ADDRESS),
  stamp: addr("NEXT_PUBLIC_STAMP_ADDRESS", process.env.NEXT_PUBLIC_STAMP_ADDRESS),
  vault: addr("NEXT_PUBLIC_VAULT_ADDRESS", process.env.NEXT_PUBLIC_VAULT_ADDRESS),
  bond: addr("NEXT_PUBLIC_BOND_ADDRESS", process.env.NEXT_PUBLIC_BOND_ADDRESS),
  lens: addr("NEXT_PUBLIC_LENS_ADDRESS", process.env.NEXT_PUBLIC_LENS_ADDRESS),
  qusdc: addr("NEXT_PUBLIC_QUSDC_ADDRESS", process.env.NEXT_PUBLIC_QUSDC_ADDRESS, isMainnet ? MAINNET_EXTERNAL.qusdc : undefined),
  qieIdCheck: addr("NEXT_PUBLIC_QIE_ID_CHECK_ADDRESS", process.env.NEXT_PUBLIC_QIE_ID_CHECK_ADDRESS),
  qieNameRegistry: addr("NEXT_PUBLIC_QIE_NAME_REGISTRY_ADDRESS", process.env.NEXT_PUBLIC_QIE_NAME_REGISTRY_ADDRESS, isMainnet ? MAINNET_EXTERNAL.qieNameRegistry : undefined),
  qieUsdOracle: addr("NEXT_PUBLIC_ORACLE_ADDRESS", process.env.NEXT_PUBLIC_ORACLE_ADDRESS, isMainnet ? MAINNET_EXTERNAL.qieUsdOracle : undefined),
  dexRouter: isMainnet ? MAINNET_EXTERNAL.dexRouter : zeroAddress,
  wqie: isMainnet ? MAINNET_EXTERNAL.wqie : zeroAddress,
} as const;

/** First block to scan for Showmark logs. */
export const deployBlock = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");

export const NATIVE_TOKEN: Address = zeroAddress;

export function isDeployed(): boolean {
  return addresses.registry !== zeroAddress && addresses.vault !== zeroAddress;
}
