import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registryAbi, vaultAbi } from "@/lib/chain/abi";
import { qieTestnet } from "@/lib/chain/chains";
import { checkInTypes, doorPassTypes, linkWalletTypes, ticketTypes } from "@/lib/chain/eip712";
import { NextRequest } from "next/server";
import type { TxStatus } from "@/lib/api/types";
import { GET as txRoute } from "@/app/api/tx/[hash]/route";
import { setChainContext, type ChainContext } from "../chain";
import { setDatabase } from "../db/client";
import { checkInStatusCopy } from "../errors";
import { syncOnce } from "../indexer/sync";
import { MemoryStore, setStore } from "../kv";
import { attendeeShare, payingCampaignIds, pendingFor } from "../payouts";
import { getCampaign, getEvent, getPassport, getTraction } from "../queries";
import { relayLinkWallet, relayWithdraw } from "../relayer/actions";
import { relayCheckIns, simulateCheckIns, DEFAULT_RELAY_OPTIONS, type RelayerDeps } from "../relayer/queue";
import { settleGasLimit } from "../relayer/settle";
import type { CheckInData } from "../schemas";
import { createTestDatabase } from "../testing/pglite";

// End to end on a local anvil running as chain 1983: deploy with packages/contracts/script/Deploy.s.sol, create an
// event and two campaigns, relay check-ins through the real relayer code (simulation, Redis-style queue, nonce lock,
// chained settleBatch), index the logs into Postgres (PGlite), read them back through the server queries, then link
// a wallet and withdraw through the relayer.
//
// Opt in with RUN_ANVIL_TESTS=1 (needs anvil and forge on PATH). The keys below are anvil's public defaults and are
// used only against this throwaway local node.

const contractsDir = fileURLToPath(new URL("../../../../../packages/contracts", import.meta.url));
const hasTool = (bin: string) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
const missing = [
  process.env.RUN_ANVIL_TESTS !== "1" && "RUN_ANVIL_TESTS=1",
  !hasTool("anvil") && "anvil on PATH",
  !hasTool("forge") && "forge on PATH",
  !existsSync(join(contractsDir, "script/Deploy.s.sol")) && "packages/contracts/script/Deploy.s.sol",
].filter(Boolean);
if (missing.length > 0) {
  process.stdout.write(`anvil integration test skipped: needs ${missing.join(", ")}\n`);
}

const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  organizer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  door: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  sponsor: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  relayer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  wallet: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const satisfies Record<string, Hex>;

const testnetNamesAbi = parseAbi(["function claim(string label)"]);

interface Deployment {
  registry: Address;
  vault: Address;
  qusdc: Address;
  oracle: Address;
  nameRegistry: Address;
  deployBlock: number;
}

describe.skipIf(missing.length > 0)("relayer, indexer and queries against anvil (chain 1983)", () => {
  const port = 8_700 + Math.floor(Math.random() * 200);
  const rpc = `http://127.0.0.1:${port}`;
  const deploymentsDir = `deployments/anvil/vitest-${port}`;
  const chain = defineChain({ ...qieTestnet, rpcUrls: { default: { http: [rpc] } } });
  const client = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  const organizer = privateKeyToAccount(KEYS.organizer);
  const door = privateKeyToAccount(KEYS.door);
  const sponsor = privateKeyToAccount(KEYS.sponsor);
  const relayer = privateKeyToAccount(KEYS.relayer);
  const wallet = privateKeyToAccount(KEYS.wallet);

  let anvil: ChildProcess;
  let d: Deployment;
  let ctx: ChainContext;
  let deps: RelayerDeps;
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  const kv = new MemoryStore();
  let eventId: bigint;
  const openCampaign = 1n;
  const qieIdCampaign = 2n;
  let firstPass: PrivateKeyAccount;

  const domain = () => ({ name: "Showmark", version: "1", chainId: 1983, verifyingContract: d.registry }) as const;
  const walletFor = (account: PrivateKeyAccount) => createWalletClient({ account, chain, transport: http(rpc) });
  const confirm = async (pending: Promise<Hex>) => {
    const receipt = await client.waitForTransactionReceipt({ hash: await pending });
    if (receipt.status !== "success") throw new Error(`transaction ${receipt.transactionHash} reverted`);
    return receipt;
  };

  /** What the door screen and the attendee's phone produce together for a mode 1 check-in. */
  async function signedCheckIn(pass: PrivateKeyAccount, ticketSigner?: PrivateKeyAccount): Promise<CheckInData> {
    const { timestamp } = await client.getBlock();
    const ticket = privateKeyToAccount(generatePrivateKey());
    const attendeeSig = await pass.signTypedData({ domain: domain(), types: checkInTypes, primaryType: "CheckIn", message: { eventId, attendee: pass.address, mode: 1 } });
    const doorSig = await door.signTypedData({ domain: domain(), types: doorPassTypes, primaryType: "DoorPass", message: { eventId, issuedAt: timestamp, ticket: ticket.address } });
    const ticketSig = await (ticketSigner ?? ticket).signTypedData({ domain: domain(), types: ticketTypes, primaryType: "Ticket", message: { eventId, attendee: pass.address } });
    return { eventId, attendee: pass.address, mode: 1, doorTime: timestamp, ticket: ticket.address, attendeeSig, doorSig, ticketSig };
  }

  const index = () => syncOnce({ maxChunks: 100, budgetMs: 30_000 }, { ctx, database, team: new Set([sponsor.address]) });

  beforeAll(async () => {
    anvil = spawn("anvil", ["--chain-id", "1983", "--port", String(port), "--silent"], { stdio: "ignore" });
    for (let i = 0; ; i++) {
      try {
        await client.getChainId();
        break;
      } catch (error) {
        if (i > 50) throw error;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await promisify(execFile)("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"], {
      cwd: contractsDir,
      env: { ...process.env, DEPLOYER_PRIVATE_KEY: KEYS.deployer, DEPLOYMENTS_DIR: deploymentsDir, FOUNDRY_BROADCAST: join(tmpdir(), `showmark-broadcast-${port}`) },
      maxBuffer: 16 * 1024 * 1024,
    });
    d = JSON.parse(readFileSync(join(contractsDir, deploymentsDir, "1983.json"), "utf8")) as Deployment;

    ctx = {
      chainId: 1983,
      client,
      registry: d.registry,
      vault: d.vault,
      qusdc: d.qusdc,
      oracle: d.oracle,
      nameRegistry: d.nameRegistry,
      paidNameRegistry: zeroAddress,
      deployBlock: BigInt(d.deployBlock),
    };
    database = await createTestDatabase();
    deps = {
      chain: { chainId: 1983, client, account: relayer, registry: d.registry, vault: d.vault },
      kv,
      campaignsFor: (id) => payingCampaignIds(database.db, id),
      options: { ...DEFAULT_RELAY_OPTIONS, pollMs: 20 },
      now: Date.now,
    };

    const { timestamp } = await client.getBlock();
    const startsAt = timestamp - 60n;
    const endsAt = timestamp + 3_600n;
    await confirm(walletFor(organizer).writeContract({ address: d.registry, abi: registryAbi, functionName: "createSeries", args: [JSON.stringify({ name: "Anvil nights" })] }));
    const meta = JSON.stringify({ v: 1, name: "Anvil meetup", venue: "Local node", city: "Localhost", description: "Integration test" });
    await confirm(walletFor(organizer).writeContract({ address: d.registry, abi: registryAbi, functionName: "createEvent", args: [startsAt, endsAt, 0, 120, 1n, meta] }));
    eventId = (await client.readContract({ address: d.registry, abi: registryAbi, functionName: "nextEventId" })) - 1n;
    await confirm(walletFor(organizer).writeContract({ address: d.registry, abi: registryAbi, functionName: "authorizeDoorKey", args: [eventId, door.address, endsAt] }));

    const campaign = (requireQieId: boolean, name: string) => ({
      token: zeroAddress,
      pricing: 0,
      amountPerPresence: parseEther("1"),
      attendeeShareBps: 7_000,
      minProofMode: 1,
      requireQieId,
      startsAt: timestamp - 120n,
      endsAt: timestamp + 7_200n,
      maxPerEvent: 0,
      maxTotal: 0,
      openToBonded: false,
      minBond: 0n,
      metadata: JSON.stringify({ v: 1, name, sponsor: "Anvil sponsor", description: "Test pool" }),
    });
    await confirm(walletFor(sponsor).writeContract({ address: d.vault, abi: vaultAbi, functionName: "createCampaign", args: [campaign(false, "Open pool"), parseEther("10")], value: parseEther("10") }));
    await confirm(walletFor(sponsor).writeContract({ address: d.vault, abi: vaultAbi, functionName: "createCampaign", args: [campaign(true, "QIE ID pool"), parseEther("2")], value: parseEther("2") }));
    await confirm(walletFor(sponsor).writeContract({ address: d.vault, abi: vaultAbi, functionName: "approveEvents", args: [openCampaign, [eventId]] }));
    await confirm(walletFor(sponsor).writeContract({ address: d.vault, abi: vaultAbi, functionName: "approveEvents", args: [qieIdCampaign, [eventId]] }));
    await index();
  }, 180_000);

  afterAll(async () => {
    setChainContext(null);
    setDatabase(null);
    setStore(null);
    anvil?.kill();
    await database?.close();
    rmSync(join(contractsDir, deploymentsDir), { recursive: true, force: true });
    rmSync(join(tmpdir(), `showmark-broadcast-${port}`), { recursive: true, force: true });
  });

  it("relays a check-in and settles every approved campaign in the next transaction", async () => {
    firstPass = privateKeyToAccount(generatePrivateKey());
    const item = await signedCheckIn(firstPass);
    expect(await simulateCheckIns(deps.chain, [item])).toEqual([0]);

    const [result] = await relayCheckIns(deps, [item]);
    if (!result.ok) throw new Error(`relay failed: ${JSON.stringify(result)}`);
    const receipt = await client.waitForTransactionReceipt({ hash: result.txHash });
    expect(receipt.status).toBe("success");
    // anvil mines each transaction just after accepting it, so give the settlement behind it a moment to land.
    const checkInNonce = (await client.getTransaction({ hash: result.txHash })).nonce;
    for (let i = 0; (await client.getTransactionCount({ address: relayer.address })) <= checkInNonce + 1 && i < 50; i++) await new Promise((r) => setTimeout(r, 50));

    const presence = await client.readContract({ address: d.registry, abi: registryAbi, functionName: "presenceOf", args: [eventId, firstPass.address] });
    expect(presence.mode).toBe(1);
    expect(await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "isSettled", args: [openCampaign, eventId, firstPass.address] })).toBe(true);
    expect(await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "isSettled", args: [qieIdCampaign, eventId, firstPass.address] })).toBe(false);
    expect(await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "claimable", args: [zeroAddress, firstPass.address] })).toBe(
      attendeeShare(parseEther("1"), 0, 7_000),
    );

    // The settlement went out with the next nonce (same block or the next one); its real gas use must sit well
    // under the fixed limit the relayer sets.
    const head = await client.getBlockNumber({ cacheTime: 0 });
    let settleTx: { hash: Hex; nonce: number } | undefined;
    for (let n = receipt.blockNumber; n <= head && !settleTx; n++) {
      const block = await client.getBlock({ blockNumber: n, includeTransactions: true });
      settleTx = block.transactions.find((tx) => tx.from.toLowerCase() === relayer.address.toLowerCase() && tx.nonce === checkInNonce + 1);
    }
    if (!settleTx) throw new Error("no settlement transaction after the check-in");
    const settleReceipt = await client.getTransactionReceipt({ hash: settleTx.hash });
    expect(settleReceipt.gasUsed).toBeLessThan(settleGasLimit(2));
    process.stdout.write(`settleBatch(2 items) used ${settleReceipt.gasUsed} gas; checkInBatch(1) used ${receipt.gasUsed}\n`);
  });

  it("batches concurrent check-ins into one checkInBatch", async () => {
    const passes = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
    const items = await Promise.all(passes.map((p) => signedCheckIn(p)));
    const results = await Promise.all(items.map((item) => relayCheckIns(deps, [item])));
    const hashes = new Set(results.map(([r]) => (r.ok ? r.txHash : "failed")));
    expect(hashes.has("failed")).toBe(false);
    expect(hashes.size).toBe(1);
    const batchHash = [...hashes][0] as Hex;
    const tx = await client.getTransaction({ hash: batchHash });
    const call = decodeFunctionData({ abi: registryAbi, data: tx.input });
    expect(call.functionName).toBe("checkInBatch");
    expect((call.args?.[0] as readonly CheckInData[]).length).toBe(4);

    // The per-attendee view of the batch: recorded for someone in it, "reverted" for someone who is not.
    setChainContext(ctx);
    const ask = async (attendee: Address) => {
      const url = `http://localhost/api/tx/${batchHash}?event=${eventId}&attendee=${attendee}`;
      const res = await txRoute(new NextRequest(url), { params: Promise.resolve({ hash: batchHash }) });
      return (await res.json()) as TxStatus;
    };
    expect(await ask(passes[2].address)).toMatchObject({ status: "success", checkIn: { recorded: true, status: 0 } });
    expect(await ask(firstPass.address)).toMatchObject({ status: "reverted", checkIn: { recorded: false } });
  });

  it("explains a repeated check-in and a forged ticket with the registry's status", async () => {
    const [status] = await simulateCheckIns(deps.chain, [await signedCheckIn(firstPass)]);
    expect(status).toBe(1);
    expect(checkInStatusCopy(status).code).toBe("already_present");
    // Someone who read the door pass from calldata but never saw the QR cannot sign for the ticket key.
    const outsider = privateKeyToAccount(generatePrivateKey());
    const [forged] = await simulateCheckIns(deps.chain, [await signedCheckIn(outsider, privateKeyToAccount(generatePrivateKey()))]);
    expect(forged).toBe(11);
    expect(checkInStatusCopy(forged).code).toBe("bad_ticket_sig");
  });

  it("serves the indexed result through the server queries, catching up on read", async () => {
    setChainContext(ctx);
    setDatabase(database);
    setStore(kv);

    const event = await getEvent(eventId);
    expect(event?.checkedIn).toBe(5);
    expect(event?.metadata.name).toBe("Anvil meetup");
    expect(event?.campaigns.map((c) => c.name)).toEqual(["Open pool", "QIE ID pool"]);

    const passport = await getPassport(firstPass.address);
    expect(passport?.stamps).toHaveLength(1);
    expect(passport?.streaks).toEqual([{ seriesId: "1", seriesName: "Anvil nights", current: 1, best: 1 }]);
    expect(passport?.claimable.find((c) => c.symbol === "QIE")?.amount).toBe(parseEther("0.7").toString());
    expect(passport?.pending).toEqual([{ campaignId: "2", eventId: eventId.toString(), reason: "NeedsQieId", deadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }]);

    const campaign = await getCampaign(openCampaign);
    expect(campaign).toMatchObject({ settledCount: 5, funded: parseEther("10").toString(), balance: parseEther("5").toString(), teamFunded: true, status: "live" });
    for (const s of campaign?.settlements ?? []) {
      expect((await client.getTransactionReceipt({ hash: s.tx })).status).toBe("success");
    }

    const traction = await getTraction();
    expect(traction).toMatchObject({ verifiedAttendees: 5, eventsWithCheckIns: 1, organizers: 1, sponsors: { teamFunded: 1, external: 0 } });
    expect(traction.settled).toEqual([{ token: zeroAddress, symbol: "QIE", teamFunded: parseEther("5").toString(), external: "0" }]);
  });

  it("links a wallet that holds a QIE ID and pays the reward that was waiting for it", async () => {
    await confirm(walletFor(wallet).writeContract({ address: d.nameRegistry, abi: testnetNamesAbi, functionName: "claim", args: ["anvilwallet"] }));
    const { timestamp } = await client.getBlock();
    const message = { pass: firstPass.address, wallet: wallet.address, deadline: timestamp + 600n };
    const passSig = await firstPass.signTypedData({ domain: domain(), types: linkWalletTypes, primaryType: "LinkWallet", message });
    const walletSig = await wallet.signTypedData({ domain: domain(), types: linkWalletTypes, primaryType: "LinkWallet", message });

    const waiting = (await pendingFor(database.db, firstPass.address.toLowerCase()))
      .filter((p) => p.reason === "NeedsQieId")
      .map((p) => ({ campaignId: BigInt(p.campaignId), eventId: BigInt(p.eventId), attendee: firstPass.address }));
    expect(waiting).toHaveLength(1);

    const txHash = await relayLinkWallet(deps, { ...message, passSig, walletSig, relocateEventIds: [eventId] }, waiting);
    expect((await client.waitForTransactionReceipt({ hash: txHash })).status).toBe("success");
    expect(await client.readContract({ address: d.registry, abi: registryAbi, functionName: "walletOf", args: [firstPass.address] })).toBe(wallet.address);
    expect(await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "isSettled", args: [qieIdCampaign, eventId, firstPass.address] })).toBe(true);

    await index();
    const passport = await getPassport("anvilwallet.qie");
    expect(passport).toMatchObject({ pass: firstPass.address, wallet: wallet.address, qieName: "anvilwallet.qie", holdsQieId: true, pending: [] });
  });

  it("withdraws to the linked wallet and refuses an empty withdrawal", async () => {
    const before = await client.getBalance({ address: wallet.address });
    const owed = await client.readContract({ address: d.vault, abi: vaultAbi, functionName: "claimable", args: [zeroAddress, firstPass.address] });
    expect(owed).toBe(parseEther("1.4"));
    const txHash = await relayWithdraw(deps, zeroAddress, firstPass.address);
    expect((await client.waitForTransactionReceipt({ hash: txHash })).status).toBe("success");
    expect(await client.getBalance({ address: wallet.address })).toBe(before + owed);
    await expect(relayWithdraw(deps, zeroAddress, firstPass.address)).rejects.toMatchObject({ status: 422, copy: { code: "nothing_to_withdraw" } });
  });
});
