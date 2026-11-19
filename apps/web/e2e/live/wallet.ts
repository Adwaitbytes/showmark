/**
 * A real QIE Wallet stand-in for live runs. The page gets an EIP-1193 provider announced over EIP-6963 as
 * `me.qiewallet`; every request crosses into Node through an exposed function, where a viem account holding the
 * throwaway testnet key signs and sends. Nothing is mocked: transactions go to QIE testnet and the explorer.
 *
 * The Node side refuses anything that is not chain 1983, so a misconfigured build can never spend on mainnet.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  hexToBigInt,
  hexToString,
  http,
  isHex,
  type Abi,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { defineChain } from "viem/utils";
import { CHAIN_HEX, CHAIN_ID, EXPLORER, REPO_ROOT, RPC_URL, testWallet } from "./env";

export const qieTestnet = defineChain({
  id: CHAIN_ID,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "QIE Explorer", url: EXPLORER } },
});

const testAccount = privateKeyToAccount(testWallet.key);
if (testAccount.address !== testWallet.address) throw new Error("TESTNET_E2E_WALLET_ADDRESS does not match the key");

export const publicClient = createPublicClient({
  chain: qieTestnet,
  transport: http(RPC_URL),
});
/** Read calls pass straight through; the method list above is the allowlist, so the typed schema adds nothing. */
const rawRequest = publicClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>;

const ABIS: Abi[] = ["ShowmarkRegistry", "CampaignVault"].map(
  (name) => JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/contracts/abi", `${name}.json`), "utf8")) as Abi,
);

function functionNameOf(data: Hex | undefined): string {
  if (!data || data === "0x") return "transfer";
  for (const abi of ABIS) {
    try {
      return decodeFunctionData({ abi, data }).functionName;
    } catch {
      // Not this contract's function; try the next ABI.
    }
  }
  return data.slice(0, 10);
}

export interface WalletTx {
  hash: Hex;
  functionName: string;
  to: Address | null;
  value: string;
  gasFromDapp: string | null;
  gasEstimated: string | null;
  sentAt: string;
  gasUsed?: string;
  status?: "success" | "reverted";
  blockNumber?: string;
}

export interface WalletLog {
  txs: WalletTx[];
  signatures: { method: string; at: string; primaryType?: string }[];
  refused: { method: string; reason: string; at: string }[];
}

export const walletLog: WalletLog = { txs: [], signatures: [], refused: [] };

class ProviderError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

function refuse(method: string, reason: string): never {
  walletLog.refused.push({ method, reason, at: new Date().toISOString() });
  throw new ProviderError(4901, `Test harness refused ${method}: ${reason}`);
}

function chainIdOf(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
  if (typeof value === "bigint") return Number(value);
  return null;
}

interface TxParams {
  from?: string;
  to?: Address;
  data?: Hex;
  value?: Hex;
  gas?: Hex;
  chainId?: Hex;
}

export const estimateLog: { at: string; params: unknown; result: unknown }[] = [];

const READ_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "net_version",
]);

function handlerFor(account: PrivateKeyAccount) {
  const walletClient = createWalletClient({
    account,
    chain: qieTestnet,
    transport: http(RPC_URL),
  });
  return async function handle(method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return CHAIN_HEX;
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        const wanted = chainIdOf((params[0] as { chainId?: unknown } | undefined)?.chainId);
        if (wanted !== CHAIN_ID) refuse(method, `chain ${wanted} is not QIE testnet`);
        return null;
      }
      case "personal_sign": {
        const [message, from] = params as [Hex, Address];
        if (from.toLowerCase() !== account.address.toLowerCase()) refuse(method, "unknown account");
        const text = isHex(message) ? hexToString(message) : String(message);
        const siweChain = /Chain ID: (\d+)/.exec(text)?.[1];
        if (siweChain !== undefined && Number(siweChain) !== CHAIN_ID) refuse(method, `sign-in message is for chain ${siweChain}`);
        walletLog.signatures.push({ method, at: new Date().toISOString() });
        return account.signMessage({
          message: isHex(message) ? { raw: message } : String(message),
        });
      }
      case "eth_signTypedData_v4": {
        const [from, json] = params as [Address, string];
        if (from.toLowerCase() !== account.address.toLowerCase()) refuse(method, "unknown account");
        const typed = (typeof json === "string" ? JSON.parse(json) : json) as TypedDataDefinition & { domain?: { chainId?: unknown } };
        const domainChain = chainIdOf(typed.domain?.chainId);
        if (domainChain !== CHAIN_ID) refuse(method, `typed data is for chain ${domainChain}`);
        walletLog.signatures.push({
          method,
          at: new Date().toISOString(),
          primaryType: String(typed.primaryType),
        });
        return account.signTypedData(typed);
      }
      case "eth_sendTransaction": {
        const tx = params[0] as TxParams;
        if (tx.chainId !== undefined && chainIdOf(tx.chainId) !== CHAIN_ID) refuse(method, `transaction is for chain ${chainIdOf(tx.chainId)}`);
        if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) refuse(method, "unknown account");
        const live = await publicClient.getChainId();
        if (live !== CHAIN_ID) refuse(method, `RPC answers chain ${live}`);
        const value = tx.value ? hexToBigInt(tx.value) : 0n;
        // Like a real wallet: use the dapp's gas limit if it sent one, otherwise eth_estimateGas plus 20%. Both are
        // logged so a bad limit can be traced to whoever chose it. The estimate deliberately names the account by
        // address: given a local account, viem 2.58 asks eth_fillTransaction instead, and QIE testnet answers that
        // with intrinsic gas only (21,624 for approveEvents), which runs out of gas on chain.
        const requestedGas = tx.gas ? hexToBigInt(tx.gas) : null;
        const estimatedGas =
          requestedGas === null
            ? ((await publicClient.estimateGas({
                account: account.address,
                to: tx.to,
                data: tx.data,
                value,
              })) *
                120n) /
              100n
            : null;
        const hash = await walletClient.sendTransaction({
          to: tx.to,
          data: tx.data,
          value,
          gas: requestedGas ?? estimatedGas ?? undefined,
        });
        const entry: WalletTx = {
          hash,
          functionName: functionNameOf(tx.data),
          to: tx.to ?? null,
          value: value.toString(),
          gasFromDapp: requestedGas?.toString() ?? null,
          gasEstimated: estimatedGas?.toString() ?? null,
          sentAt: new Date().toISOString(),
        };
        walletLog.txs.push(entry);
        void publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }).then(
          (r) => {
            entry.status = r.status;
            entry.blockNumber = r.blockNumber.toString();
            entry.gasUsed = r.gasUsed.toString();
          },
          () => undefined,
        );
        return hash;
      }
      default:
        if (method === "eth_estimateGas") {
          const result = await rawRequest({ method, params });
          estimateLog.push({ at: new Date().toISOString(), params, result });
          return result;
        }
        if (READ_METHODS.has(method)) return rawRequest({ method, params });
        throw new ProviderError(4200, `Test harness does not support ${method}`);
    }
  };
}

interface BridgeResult {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function toBridgeError(error: unknown): BridgeResult["error"] {
  if (error instanceof ProviderError) return { code: error.code, message: error.message, data: error.data };
  if (error instanceof BaseError) {
    const withCode = error.walk((e) => typeof (e as { code?: unknown }).code === "number") as { code?: number } | null;
    const withData = error.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: string } | null;
    return {
      code: withCode?.code ?? -32603,
      message: error.shortMessage,
      data: withData?.data,
    };
  }
  return {
    code: -32603,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Runs in the page: the provider object and its EIP-6963 announcement. */
function injected({ rdns, name, chainHex }: { rdns: string; name: string; chainHex: string }) {
  type Bridge = (json: string) => Promise<string>;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const provider = {
    isQieWallet: true,
    chainId: chainHex,
    async request({ method, params }: { method: string; params?: unknown }) {
      const raw = await (window as unknown as { __showmarkLiveWallet: Bridge }).__showmarkLiveWallet(
        JSON.stringify({ method, params: params ?? [] }, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)),
      );
      const reply = JSON.parse(raw) as {
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
      };
      if (reply.error)
        throw Object.assign(new Error(reply.error.message), {
          code: reply.error.code,
          data: reply.error.data,
        });
      return reply.result;
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(fn);
    },
    removeListener(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
    },
  };
  const icon =
    "data:image/svg+xml;base64," +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#1d4ed8"/></svg>');
  const info = Object.freeze({
    uuid: "6f1d3c2a-live-harness-qie-wallet",
    name,
    icon,
    rdns,
  });
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

/**
 * Gives every page in the context a wallet: the funded test wallet by default, or another key (for example a fresh
 * gasless one when the test wallet is already linked to a pass). Call before the context's next navigation.
 */
export async function injectWallet(context: BrowserContext, account: PrivateKeyAccount = testAccount): Promise<void> {
  const handle = handlerFor(account);
  await context.exposeFunction("__showmarkLiveWallet", async (json: string): Promise<string> => {
    const { method, params } = JSON.parse(json) as {
      method: string;
      params: unknown[] | object;
    };
    try {
      const result = await handle(method, Array.isArray(params) ? params : [params]);
      return JSON.stringify({ result } satisfies BridgeResult, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
    } catch (error) {
      return JSON.stringify({
        error: toBridgeError(error),
      } satisfies BridgeResult);
    }
  });
  await context.addInitScript(injected, {
    rdns: "me.qiewallet",
    name: "QIE Wallet (test harness)",
    chainHex: CHAIN_HEX,
  });
}

export const walletAddress = testAccount.address;
