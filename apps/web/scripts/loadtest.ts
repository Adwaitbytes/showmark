// Testnet load test for the gasless check-in relayer.
//
// Generates N throwaway pass keys, has each one sign a CheckIn for one event, signs a rotating DoorPass with a door
// key exactly like the door screen does (re-signed every 15 seconds), and posts the check-ins to
// /api/relay/check-in at a fixed rate. Prints latency percentiles, failures by error code, and how many check-ins
// shared each transaction (the batching factor).
//
// It refuses to run against QIE mainnet (chain 1990): real traction must come from real people.
//
// Before running:
//   1. The door key must be authorized for the event on-chain (registry.authorizeDoorKey) and the event must be
//      inside its check-in window.
//   2. Raise RELAY_IP_LIMIT_PER_MINUTE on the target deployment, or every request after the tenth in a minute is
//      rate limited (all requests come from this machine's IP).
//
// Usage (Node 23.6 or newer runs TypeScript directly):
//   LOADTEST_DOOR_KEY=0x... node scripts/loadtest.ts --url https://preview.example --event 3 \
//     --registry 0x... --count 500 --rate 1
//
// The door key is read from the environment only, so it never lands in shell history.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const MAINNET_CHAIN_ID = 1990;
const DOOR_ROTATE_MS = 15_000;

// Mirrors src/lib/chain/eip712.ts (INTERFACES section 2.2); scripts/loadtest.test.ts keeps the two in sync.
export const checkInTypes = {
  CheckIn: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
  ],
} as const;

export const doorPassTypes = {
  DoorPass: [
    { name: "eventId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export interface LoadTestConfig {
  url: string;
  eventId: bigint;
  registry: Address;
  count: number;
  /** Check-ins per second. */
  rate: number;
  doorKey: Hex;
  timeoutMs: number;
}

export interface Sample {
  ms: number;
  status: number;
  code: string;
  txHash: string | null;
}

/** Throws unless the target is a test network. Checked against both the flag and what the server reports. */
export function assertNotMainnet(chainId: number, source: string): void {
  if (chainId === MAINNET_CHAIN_ID) {
    throw new Error(`Refusing to run: ${source} is QIE mainnet (chain ${MAINNET_CHAIN_ID}). Load tests run on testnet only.`);
  }
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export function summarize(samples: Sample[], wallMs: number) {
  const ok = samples.filter((s) => s.status === 200);
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const failures: Record<string, number> = {};
  for (const s of samples) if (s.status !== 200) failures[`${s.status} ${s.code}`] = (failures[`${s.status} ${s.code}`] ?? 0) + 1;
  const txs = new Set(ok.map((s) => s.txHash));
  return {
    requests: samples.length,
    succeeded: ok.length,
    failed: samples.length - ok.length,
    failures,
    latencyMs: {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.at(-1) ?? 0,
    },
    transactions: txs.size,
    checkInsPerTransaction: txs.size ? Number((ok.length / txs.size).toFixed(2)) : 0,
    wallSeconds: Number((wallMs / 1000).toFixed(1)),
  };
}

/** Reads the chain id the server is configured for from its sign-in message (EIP-4361 "Chain ID: n"). */
async function serverChainId(url: string): Promise<number> {
  const probe = privateKeyToAccount(generatePrivateKey()).address;
  const res = await fetch(`${url}/api/auth/nonce?address=${probe}`);
  if (!res.ok) throw new Error(`Could not read the server chain id: /api/auth/nonce answered ${res.status}`);
  const body = (await res.json()) as { message?: string };
  const match = /Chain ID: (\d+)/.exec(body.message ?? "");
  if (!match) throw new Error("Could not read the server chain id from its sign-in message");
  return Number(match[1]);
}

function parseConfig(): LoadTestConfig & { chainId: number } {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      event: { type: "string" },
      registry: { type: "string" },
      "chain-id": { type: "string", default: "1983" },
      count: { type: "string", default: "100" },
      rate: { type: "string", default: "2" },
      "timeout-ms": { type: "string", default: "30000" },
    },
  });
  const doorKey = process.env.LOADTEST_DOOR_KEY;
  if (!values.url || !values.event || !values.registry) throw new Error("Required: --url, --event and --registry");
  if (!isAddress(values.registry)) throw new Error("--registry must be an address");
  if (!doorKey || !/^0x[0-9a-fA-F]{64}$/.test(doorKey)) throw new Error("Set LOADTEST_DOOR_KEY to the door key's private key");
  const count = Number(values.count);
  const rate = Number(values.rate);
  if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("--count must be 1 to 10000");
  if (!(rate > 0 && rate <= 100)) throw new Error("--rate must be above 0 and at most 100 per second");
  return {
    url: values.url.replace(/\/$/, ""),
    eventId: BigInt(values.event),
    registry: getAddress(values.registry),
    chainId: Number(values["chain-id"]),
    count,
    rate,
    doorKey: doorKey as Hex,
    timeoutMs: Number(values["timeout-ms"]),
  };
}

async function run(config: LoadTestConfig, chainId: number): Promise<Sample[]> {
  const door = privateKeyToAccount(config.doorKey);
  const domain = { name: "Showmark", version: "1", chainId, verifyingContract: config.registry } as const;

  let doorPass = { issuedAt: 0n, sig: "0x" as Hex };
  const rotate = async () => {
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    const sig = await door.signTypedData({ domain, types: doorPassTypes, primaryType: "DoorPass", message: { eventId: config.eventId, issuedAt } });
    doorPass = { issuedAt, sig };
  };
  await rotate();
  const timer = setInterval(() => {
    rotate().catch((error: unknown) => process.stderr.write(`door rotation failed: ${String(error)}\n`));
  }, DOOR_ROTATE_MS);

  // Sign every attendee's CheckIn up front so signing time never counts as relayer latency.
  const passes = await Promise.all(
    Array.from({ length: config.count }, async () => {
      const pass = privateKeyToAccount(generatePrivateKey());
      const sig = await pass.signTypedData({ domain, types: checkInTypes, primaryType: "CheckIn", message: { eventId: config.eventId, attendee: pass.address } });
      return { address: pass.address, sig };
    }),
  );

  const samples: Sample[] = [];
  const started = Date.now();
  const inflight = passes.map(async (pass, i) => {
    const due = started + (i * 1000) / config.rate;
    await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())));
    const body = {
      eventId: config.eventId.toString(),
      attendee: pass.address,
      mode: 1,
      doorTime: doorPass.issuedAt.toString(),
      attendeeSig: pass.sig,
      doorSig: doorPass.sig,
    };
    const t0 = performance.now();
    let sample: Sample;
    try {
      const res = await fetch(`${config.url}/api/relay/check-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const json = (await res.json()) as { txHash?: string; error?: { code: string } };
      sample = { ms: Math.round(performance.now() - t0), status: res.status, code: json.error?.code ?? "ok", txHash: json.txHash ?? null };
    } catch (error) {
      sample = { ms: Math.round(performance.now() - t0), status: 0, code: error instanceof Error ? error.name : "network_error", txHash: null };
    }
    samples.push(sample);
    if ((i + 1) % 50 === 0) process.stdout.write(`${i + 1}/${config.count} sent\n`);
  });
  await Promise.all(inflight);
  clearInterval(timer);
  process.stdout.write(`${JSON.stringify(summarize(samples, Date.now() - started), null, 2)}\n`);
  return samples;
}

async function main(): Promise<void> {
  const config = parseConfig();
  assertNotMainnet(config.chainId, "--chain-id");
  const reported = await serverChainId(config.url);
  assertNotMainnet(reported, config.url);
  if (reported !== config.chainId) throw new Error(`The server runs chain ${reported} but --chain-id is ${config.chainId}`);
  process.stdout.write(`Load test: ${config.count} check-ins to event ${config.eventId} on chain ${reported} at ${config.rate}/s\n`);
  await run(config, reported);
}

const isEntryPoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
