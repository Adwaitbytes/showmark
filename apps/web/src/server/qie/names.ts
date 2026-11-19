import { BaseError, ContractFunctionRevertedError, getAddress, isAddressEqual, parseAbi, zeroAddress, type Address } from "viem";
import { chainContext, type ChainContext } from "../chain";
import { AppError, COMMON_ERRORS } from "../errors";
import { getStore, type KeyValueStore } from "../kv";
import { log } from "../log";

// QIE ID names, verified against mainnet on 19 Nov 2026:
// - Zone (ERC-721, 0x9aab...7bdc) stores each name as tokenId = uint256(keccak256(abi.encodePacked(parent, label))),
//   where a top-level name `alice.qie` has label "alice" and parent "qie". `domainOwnerByName(label, parent)` is the
//   forward lookup; it reverts for names that do not exist, so `domainExistsByName` is checked first.
// - Zone cannot turn a tokenId back into text. The root registry proxy (0x1D69...f62e, registered on Zone via
//   `registry(address)`) keeps `userDomain(address) -> fqn` and `domainNames(uint256[]) -> fqn[]`, which give the
//   reverse lookup. Every reverse result is checked forward against Zone ownership before it is trusted, because
//   the registry's record can lag a plain ERC-721 transfer.

export const zoneNamesAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function domainExistsByName(string label, string parent) view returns (bool)",
  "function domainOwnerByName(string label, string parent) view returns (address)",
]);

export const nameRegistryAbi = parseAbi([
  "function userDomain(address owner) view returns (string)",
  "function domainNames(uint256[] tokenIds) view returns (string[])",
]);

const LABEL = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const CACHE_MS = 10 * 60_000;

export interface QieName {
  label: string;
  parent: string;
  fqn: string;
}

/** `Alice.QIE`, `alice.qie` and `alice` all normalize to alice.qie. Returns null for anything that cannot be a name. */
export function normalizeName(input: string): QieName | null {
  const value = input.trim().toLowerCase();
  const fqn = value.endsWith(".qie") ? value : `${value}.qie`;
  const parts = fqn.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.slice(0, -1).every((p) => LABEL.test(p))) return null;
  return { label: parts[0], parent: parts.slice(1).join("."), fqn };
}

export function looksLikeName(input: string): boolean {
  return input.trim().toLowerCase().endsWith(".qie");
}

function isRevert(error: unknown): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) !== null;
}

function upstream(error: unknown): AppError {
  return new AppError(503, COMMON_ERRORS.upstream, { cause: error });
}

interface NameDeps {
  ctx: ChainContext;
  kv: KeyValueStore;
}

function deps(partial?: Partial<NameDeps>): NameDeps {
  return { ctx: partial?.ctx ?? chainContext(), kv: partial?.kv ?? getStore() };
}

async function ownerOfName(ctx: ChainContext, name: QieName): Promise<Address | null> {
  if (ctx.zone === zeroAddress) return null;
  try {
    const exists = await ctx.client.readContract({ address: ctx.zone, abi: zoneNamesAbi, functionName: "domainExistsByName", args: [name.label, name.parent] });
    if (!exists) return null;
    const owner = await ctx.client.readContract({ address: ctx.zone, abi: zoneNamesAbi, functionName: "domainOwnerByName", args: [name.label, name.parent] });
    return owner === zeroAddress ? null : getAddress(owner);
  } catch (error) {
    // The testnet MockZone has no name functions; a revert there simply means "no such name".
    if (isRevert(error)) return null;
    throw upstream(error);
  }
}

/** Address that owns `name` on Zone right now, or null. */
export async function addressOf(input: string, partial?: Partial<NameDeps>): Promise<Address | null> {
  const name = normalizeName(input);
  if (!name) return null;
  const { ctx, kv } = deps(partial);
  const key = `qie:addr:${ctx.chainId}:${name.fqn}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached === "" ? null : getAddress(cached);
  const owner = await ownerOfName(ctx, name);
  await kv.set(key, owner ?? "", { px: CACHE_MS });
  return owner;
}

async function reverseCandidate(ctx: ChainContext, address: Address): Promise<string | null> {
  const fromRegistry = await ctx.client.readContract({ address: ctx.nameRegistry, abi: nameRegistryAbi, functionName: "userDomain", args: [address] });
  if (fromRegistry) return fromRegistry;
  const balance = await ctx.client.readContract({ address: ctx.zone, abi: zoneNamesAbi, functionName: "balanceOf", args: [address] });
  if (balance === 0n) return null;
  const tokenId = await ctx.client.readContract({ address: ctx.zone, abi: zoneNamesAbi, functionName: "tokenOfOwnerByIndex", args: [address, 0n] });
  const [fqn] = await ctx.client.readContract({ address: ctx.nameRegistry, abi: nameRegistryAbi, functionName: "domainNames", args: [[tokenId]] });
  return fqn || null;
}

/** The QIE ID name held by `address`, verified forward on Zone, or null. */
export async function nameOf(address: Address, partial?: Partial<NameDeps>): Promise<string | null> {
  const { ctx, kv } = deps(partial);
  if (ctx.nameRegistry === zeroAddress || ctx.zone === zeroAddress) return null;
  const key = `qie:name:${ctx.chainId}:${address.toLowerCase()}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached === "" ? null : cached;

  let verified: string | null = null;
  try {
    const candidate = await reverseCandidate(ctx, address);
    const name = candidate ? normalizeName(candidate) : null;
    if (name) {
      const owner = await ownerOfName(ctx, name);
      if (owner && isAddressEqual(owner, address)) verified = name.fqn;
      else log.info("qie.name_mismatch", { address, candidate: name.fqn });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (!isRevert(error)) throw upstream(error);
  }
  await kv.set(key, verified ?? "", { px: CACHE_MS });
  return verified;
}

/** True when `address` holds at least one QIE ID, the rule campaigns use for `requireQieId`. */
export async function holdsQieId(address: Address, partial?: Partial<NameDeps>): Promise<boolean> {
  const { ctx } = deps(partial);
  if (ctx.zone === zeroAddress) return false;
  try {
    const balance = await ctx.client.readContract({ address: ctx.zone, abi: zoneNamesAbi, functionName: "balanceOf", args: [address] });
    return balance > 0n;
  } catch (error) {
    throw upstream(error);
  }
}
