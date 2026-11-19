import { BaseError, ContractFunctionRevertedError, getAddress, isAddressEqual, parseAbi, zeroAddress, type Address } from "viem";
import { chainContext, type ChainContext } from "../chain";
import { AppError, COMMON_ERRORS } from "../errors";
import { getStore, type KeyValueStore } from "../kv";
import { log } from "../log";

// QIE ID names, read from the QIE ID root registry (mainnet 0x1D69...f62e, an ERC1967 proxy), verified against
// mainnet on 19 Nov 2026:
// - `userDomain(address) -> fqn` is the reverse lookup and the QIE ID test: a wallet holds a QIE ID when it is
//   non-empty. The vault's QieIdCheck adapter makes the same call, so the app and the chain always agree.
// - `resolver(fqn) -> (tokenId, owner)` is the forward lookup. Names bought through the paid registry
//   (mainnet 0x26cC...7223) resolve there with the same function; that registry has no reverse lookup.
// Each reverse result is confirmed forward (`resolver(fqn).owner == address`) before it is shown.

export const nameRegistryAbi = parseAbi([
  "function userDomain(address owner) view returns (string)",
  "function resolver(string fqn) view returns (uint256 tokenId, address owner)",
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

/** Owner of `fqn` in one registry, or null when the registry has no such name (or no such function). */
async function resolveIn(ctx: ChainContext, registry: Address, fqn: string): Promise<Address | null> {
  if (registry === zeroAddress) return null;
  try {
    const [, owner] = await ctx.client.readContract({ address: registry, abi: nameRegistryAbi, functionName: "resolver", args: [fqn] });
    return owner === zeroAddress ? null : getAddress(owner);
  } catch (error) {
    if (isRevert(error)) return null;
    throw upstream(error);
  }
}

async function userDomain(ctx: ChainContext, address: Address): Promise<string> {
  if (ctx.nameRegistry === zeroAddress) return "";
  try {
    return await ctx.client.readContract({ address: ctx.nameRegistry, abi: nameRegistryAbi, functionName: "userDomain", args: [address] });
  } catch (error) {
    if (isRevert(error)) return "";
    throw upstream(error);
  }
}

/** Address that owns `name` right now, or null. Checks the root registry, then the paid registry. */
export async function addressOf(input: string, partial?: Partial<NameDeps>): Promise<Address | null> {
  const name = normalizeName(input);
  if (!name) return null;
  const { ctx, kv } = deps(partial);
  const key = `qie:addr:${ctx.chainId}:${name.fqn}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached === "" ? null : getAddress(cached);
  const owner = (await resolveIn(ctx, ctx.nameRegistry, name.fqn)) ?? (await resolveIn(ctx, ctx.paidNameRegistry, name.fqn));
  await kv.set(key, owner ?? "", { px: CACHE_MS });
  return owner;
}

/** The QIE ID name of `address`, confirmed forward in the registry, or null. */
export async function nameOf(address: Address, partial?: Partial<NameDeps>): Promise<string | null> {
  const { ctx, kv } = deps(partial);
  if (ctx.nameRegistry === zeroAddress) return null;
  const key = `qie:name:${ctx.chainId}:${address.toLowerCase()}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached === "" ? null : cached;

  let verified: string | null = null;
  const name = normalizeName(await userDomain(ctx, address));
  if (name) {
    const owner = await resolveIn(ctx, ctx.nameRegistry, name.fqn);
    if (owner && isAddressEqual(owner, address)) verified = name.fqn;
    else log.info("qie.name_mismatch", { address, candidate: name.fqn });
  }
  await kv.set(key, verified ?? "", { px: CACHE_MS });
  return verified;
}

/** True when the root registry records a QIE ID for `address`: the rule campaigns use for `requireQieId`. */
export async function holdsQieId(address: Address, partial?: Partial<NameDeps>): Promise<boolean> {
  const { ctx } = deps(partial);
  return (await userDomain(ctx, address)) !== "";
}
