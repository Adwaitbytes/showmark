import { parseEventLogs, type Address, type Log, type ParseEventLogsReturnType } from "viem";
import { bondAbi, registryAbi, vaultAbi } from "@/lib/chain/abi";

export type RegistryLog = ParseEventLogsReturnType<typeof registryAbi, undefined, true>[number];
export type VaultLog = ParseEventLogsReturnType<typeof vaultAbi, undefined, true>[number];
export type BondLog = ParseEventLogsReturnType<typeof bondAbi, undefined, true>[number];
export type ShowmarkLog = RegistryLog | VaultLog | BondLog;

export interface Contracts {
  registry: Address;
  vault: Address;
  /** OrganizerBond, or the zero address when the network has none configured. */
  bond?: Address;
}

/**
 * Decodes raw logs from the registry and the vault with each contract's own ABI and returns them in chain order.
 * Logs from other addresses, and events that are not part of the Showmark ABI (for example OwnershipTransferred),
 * are dropped.
 */
export function decodeShowmarkLogs(logs: Log[], contracts: Contracts): ShowmarkLog[] {
  const registry = contracts.registry.toLowerCase();
  const vault = contracts.vault.toLowerCase();
  const fromRegistry = logs.filter((l) => l.address.toLowerCase() === registry);
  const fromVault = logs.filter((l) => l.address.toLowerCase() === vault);
  const bond = contracts.bond?.toLowerCase();
  const fromBond = bond ? logs.filter((l) => l.address.toLowerCase() === bond) : [];
  const decoded: ShowmarkLog[] = [
    ...parseEventLogs({ abi: registryAbi, logs: fromRegistry, strict: true }),
    ...parseEventLogs({ abi: vaultAbi, logs: fromVault, strict: true }),
    ...parseEventLogs({ abi: bondAbi, logs: fromBond, strict: true }),
  ];
  return decoded.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}
