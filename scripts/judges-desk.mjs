// Opens the Judges' desk on a network: creates the desk event (open until 13 Dec 2026), authorizes a server-held
// door key, funds a small team-labelled pool and approves the event into it. Prints the event id; the shell wrapper
// stores the door key in Vercel. Secrets come only from the environment. Usage: node scripts/judges-desk.mjs 1990 2
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chainId = Number(process.argv[2]);
const poolQie = process.argv[3] ?? "2";
if (chainId !== 1990 && chainId !== 1983) throw new Error("usage: node scripts/judges-desk.mjs <1990|1983> [poolQie]");
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const doorKey = process.env.JUDGES_DOOR_KEY;
if (!deployerKey || !doorKey) throw new Error("DEPLOYER_PRIVATE_KEY and JUDGES_DOOR_KEY must be set");

const root = new URL("../", import.meta.url);
const dep = JSON.parse(readFileSync(new URL(`packages/contracts/deployments/${chainId}.json`, root), "utf8"));
const registryAbi = JSON.parse(readFileSync(new URL("packages/contracts/abi/ShowmarkRegistry.json", root), "utf8"));
const vaultAbi = JSON.parse(readFileSync(new URL("packages/contracts/abi/CampaignVault.json", root), "utf8"));
const rpc = chainId === 1990 ? "https://rpc1mainnet.qie.digital" : "https://rpc1testnet.qie.digital";
const chain = { id: chainId, name: `QIE ${chainId}`, nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };

const account = privateKeyToAccount(deployerKey);
const doorAddress = privateKeyToAccount(doorKey).address;
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ chain, account, transport: http() });

async function send(address, abi, functionName, args, value) {
  const { request, result } = await pub.simulateContract({ address, abi, functionName, args, value, account });
  // QIE's load-balanced RPC can estimate against a block-old state, so leave generous headroom.
  const hash = await wallet.writeContract({ ...request, gas: (request.gas ?? 500_000n) * 2n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  console.log(`${functionName} ${hash}`);
  return result;
}

const now = (await pub.getBlock()).timestamp;
const end = 1797120000n; // 13 Dec 2026 00:00 UTC, three days past winners day
const eventId = await send(dep.registry, registryAbi, "createEvent", [now - 600n, end, 500, 120, 0n, JSON.stringify({
  v: 1, name: "Judges' desk", venue: "QIE Hackathon 3.0 demo week", city: "Online",
  description: "A permanent desk where judges can check in from their own phone and see a real payout. Run by the Showmark team; the pool is team-funded.",
})]);
await send(dep.registry, registryAbi, "authorizeDoorKey", [eventId, doorAddress, end + 3600n]);
const deposit = parseEther(poolQie);
const campaignId = await send(dep.vault, vaultAbi, "createCampaign", [{
  token: zeroAddress, pricing: 0, amountPerPresence: parseEther("0.05"), attendeeShareBps: 8000, minProofMode: 1, requireQieId: false,
  startsAt: now - 900n, endsAt: end, maxPerEvent: 0, maxTotal: 0, openToBonded: false, minBond: 0n,
  metadata: JSON.stringify({ v: 1, name: "Judges' desk pool", sponsor: "Showmark team", description: "Team-funded pool for the Judges' desk." }),
}, deposit], deposit);
await send(dep.vault, vaultAbi, "approveEvents", [campaignId, [eventId]]);
console.log(`EVENT_ID=${eventId}`);
console.log(`CAMPAIGN_ID=${campaignId}`);
