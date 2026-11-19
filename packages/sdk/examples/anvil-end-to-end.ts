// End to end on a local chain: deploy the real ShowmarkRegistry and PresenceLens to anvil, run both proof modes and a wallet link
// through the SDK, and read the results back with ShowmarkClient. Needs Foundry (anvil and forge) on PATH.
//
//   pnpm --filter @showmark/sdk build && node examples/anvil-end-to-end.ts
//
// A small local relayer stands in for the Showmark API so the relay calls run unchanged. It simulates every call
// before sending it, like the real one, but it has no rate limits, batching or settlement.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  ShowmarkClient,
  buildDoorAttestCheckIn,
  createAttendeeCode,
  createDoorPass,
  decodeAttendeeCode,
  doorPassUrl,
  encodeAttendeeCode,
  presenceAbi,
  registryAbi,
  signLinkWallet,
} from "@showmark/sdk";

const sdkRoot = fileURLToPath(new URL("../", import.meta.url));

/** Creation bytecode from a fresh (incremental) forge build of packages/contracts, so the run uses current sources. */
function bytecodeOf(name: "ShowmarkRegistry" | "PresenceLens"): Hex {
  const contractsRoot = fileURLToPath(new URL("../../contracts/", import.meta.url));
  const build = spawnSync(
    "forge",
    ["build", "--root", contractsRoot, "--out", `${sdkRoot}.forge-out/out`, "--cache-path", `${sdkRoot}.forge-out/cache`, "--skip", "test", "--skip", "script"],
    { stdio: "ignore" },
  );
  if (build.status !== 0) throw new Error("forge build failed; install Foundry from https://getfoundry.sh");
  const artifact = JSON.parse(readFileSync(`${sdkRoot}.forge-out/out/${name}.sol/${name}.json`, "utf8")) as { bytecode: { object: Hex } };
  return artifact.bytecode.object;
}

async function startAnvil(): Promise<{ rpcUrl: string; process: ChildProcess }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const child = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const probe = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0 }) });
  for (let i = 0; i < 100; i++) {
    try {
      await probe.getChainId();
      return { rpcUrl, process: child };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  throw new Error("anvil did not start; install Foundry from https://getfoundry.sh");
}

type Json = Record<string, unknown>;

/** A stand-in for /api/relay/* and /api/tx/*: simulate, send, answer in the documented shapes. */
function startLocalRelayer(rpcUrl: string, registry: Address, relayerKey: Hex): Promise<{ url: string; server: Server }> {
  const account = privateKeyToAccount(relayerKey);
  const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
  const reader = createPublicClient({ chain: foundry, transport: http(rpcUrl), pollingInterval: 100 });

  async function submit(body: Json, path: string): Promise<Hex> {
    if (path === "/api/relay/check-in") {
      const d = {
        eventId: BigInt(String(body.eventId)),
        attendee: body.attendee as Address,
        mode: Number(body.mode),
        doorTime: BigInt(String(body.doorTime)),
        ticket: body.ticket as Address,
        attendeeSig: body.attendeeSig as Hex,
        doorSig: body.doorSig as Hex,
        ticketSig: body.ticketSig as Hex,
      };
      const { request } = await reader.simulateContract({ account, address: registry, abi: registryAbi, functionName: "checkIn", args: [d] });
      return wallet.writeContract(request);
    }
    if (path === "/api/relay/link-wallet") {
      const { request } = await reader.simulateContract({
        account,
        address: registry,
        abi: registryAbi,
        functionName: "linkWallet",
        args: [
          body.pass as Address,
          body.wallet as Address,
          BigInt(String(body.deadline)),
          body.passSig as Hex,
          body.walletSig as Hex,
          (body.relocateEventIds as string[]).map((id) => BigInt(id)),
        ],
      });
      return wallet.writeContract(request);
    }
    throw new Error(`unknown route ${path}`);
  }

  const server = createServer((req, res) => {
    const reply = (status: number, payload: Json): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const path = req.url ?? "/";
    if (req.method === "GET" && path.startsWith("/api/tx/")) {
      reader
        .getTransactionReceipt({ hash: path.slice("/api/tx/".length) as Hex })
        .then((r) => reply(200, { status: r.status === "success" ? "success" : "reverted", blockNumber: r.blockNumber.toString() }))
        .catch(() => reply(200, { status: "pending" }));
      return;
    }
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      submit(JSON.parse(raw) as Json, path)
        .then((txHash) => reply(200, path === "/api/relay/check-in" ? { txHash, status: "submitted" } : { txHash }))
        .catch((error: unknown) => {
          const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
          const code = reverted instanceof ContractFunctionRevertedError ? (reverted.data?.errorName ?? "Reverted") : "RelayFailed";
          reply(422, { error: { code, message: `The registry rejected this call with ${code}.`, action: "Check the signatures and try again." } });
        });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }));
  });
}

export interface EndToEndResult {
  registry: Address;
  eventId: bigint;
  attendeeA: Address;
  attendeeB: Address;
  wallet: Address;
  modeOne: { attended: boolean; mode: number };
  modeTwo: { attended: boolean; mode: number };
  streak: { current: number; best: number };
  checkedIn: number;
  walletAttended: boolean;
  /** Through PresenceLens: the wallet resolves to attendee A's pass. */
  walletPresenceKey: Address;
  walletAttendedCount: number;
  linkedPass: Address | null;
}

export async function runEndToEnd(): Promise<EndToEndResult> {
  const registryCode = bytecodeOf("ShowmarkRegistry");
  const lensCode = bytecodeOf("PresenceLens");
  const anvil = await startAnvil();
  let relayer: Server | null = null;
  try {
    const keys = { organizer: generatePrivateKey(), relayer: generatePrivateKey() };
    const organizer = privateKeyToAccount(keys.organizer);
    const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(anvil.rpcUrl) });
    for (const key of Object.values(keys)) {
      await testClient.setBalance({ address: privateKeyToAccount(key).address, value: parseEther("10") });
    }
    const reader = createPublicClient({ chain: foundry, transport: http(anvil.rpcUrl), pollingInterval: 100 });
    const organizerWallet = createWalletClient({ account: organizer, chain: foundry, transport: http(anvil.rpcUrl) });

    // 1. Deploy the registry and open a one-event series, the way the organizer console does.
    const deployHash = await organizerWallet.deployContract({
      abi: registryAbi,
      bytecode: registryCode,
      args: [organizer.address, "https://showmark.example/api/stamp/"],
    });
    const deployed = (await reader.waitForTransactionReceipt({ hash: deployHash })).contractAddress;
    if (!deployed) throw new Error("registry deployment returned no address");
    const registry = getAddress(deployed);
    const lensReceipt = await reader.waitForTransactionReceipt({
      hash: await organizerWallet.deployContract({ abi: presenceAbi, bytecode: lensCode, args: [registry] }),
    });
    if (!lensReceipt.contractAddress) throw new Error("lens deployment returned no address");
    const lens = getAddress(lensReceipt.contractAddress);
    const send = async (hash: Hex): Promise<void> => {
      const receipt = await reader.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    };
    const seriesId = await reader.readContract({ address: registry, abi: registryAbi, functionName: "nextSeriesId" });
    await send(await organizerWallet.writeContract({ address: registry, abi: registryAbi, functionName: "createSeries", args: ['{"v":1,"name":"SDK nights"}'] }));
    const now = (await reader.getBlock()).timestamp;
    const eventId = await reader.readContract({ address: registry, abi: registryAbi, functionName: "nextEventId" });
    const metadata = JSON.stringify({ v: 1, name: "SDK demo night", venue: "Localhost", city: "Anvil", description: "End to end check" });
    await send(
      await organizerWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "createEvent",
        args: [now - 600n, now + 3_600n, 0, 120, seriesId, metadata],
      }),
    );
    const door = privateKeyToAccount(generatePrivateKey());
    await send(
      await organizerWallet.writeContract({ address: registry, abi: registryAbi, functionName: "authorizeDoorKey", args: [eventId, door.address, now + 7_200n] }),
    );

    const local = await startLocalRelayer(anvil.rpcUrl, registry, keys.relayer);
    relayer = local.server;
    const showmark = new ShowmarkClient({ chain: foundry, rpcUrls: [anvil.rpcUrl], addresses: { registry, lens }, relayUrl: local.url });
    const domain = { chainId: foundry.id, registry };

    // 2. Mode 1: the door screen shows a signed pass with this rotation's ticket key, the attendee's phone opens the
    //    URL, signs CheckIn with the pass key and Ticket with the ticket key, and checks in.
    const attendeeA = privateKeyToAccount(generatePrivateKey());
    const url = doorPassUrl("https://showmark.example", await createDoorPass({ ...domain, signer: door, eventId }));
    const first = await showmark.checkIn({ doorPass: url, signer: attendeeA });
    await showmark.waitForTx(first.txHash, { intervalMs: 200 });

    // 3. Mode 2: the attendee shows an SM2 code, the door scans it and attests.
    const attendeeB = privateKeyToAccount(generatePrivateKey());
    const code = encodeAttendeeCode(await createAttendeeCode({ ...domain, signer: attendeeB, eventId }));
    const scanned = decodeAttendeeCode(code);
    if (!scanned) throw new Error("attendee code did not decode");
    const second = await showmark.relayCheckIn(await buildDoorAttestCheckIn({ ...domain, attendeeCode: scanned, signer: door }));
    await showmark.waitForTx(second.txHash, { intervalMs: 200 });

    // 4. Attendee A links a wallet; both keys sign LinkWallet and the stamp moves to the wallet.
    const wallet = privateKeyToAccount(generatePrivateKey());
    const link = { pass: attendeeA.address, wallet: wallet.address, deadline: now + 3_600n };
    const linked = await showmark.relayLinkWallet({
      ...link,
      passSig: await signLinkWallet({ ...domain, ...link, signer: attendeeA }),
      walletSig: await signLinkWallet({ ...domain, ...link, signer: wallet }),
      relocateEventIds: [eventId],
    });
    await showmark.waitForTx(linked.txHash, { intervalMs: 200 });

    // 5. Read everything back from the chain.
    const event = await showmark.getEvent(eventId);
    const a = await showmark.presenceOf(eventId, attendeeA.address);
    const b = await showmark.presenceOf(eventId, attendeeB.address);
    return {
      registry,
      eventId,
      attendeeA: attendeeA.address,
      attendeeB: attendeeB.address,
      wallet: wallet.address,
      modeOne: { attended: await showmark.hasAttended(eventId, attendeeA.address), mode: a.mode },
      modeTwo: { attended: await showmark.hasAttended(eventId, attendeeB.address), mode: b.mode },
      streak: await showmark.streakOf(seriesId, wallet.address),
      checkedIn: event?.checkedIn ?? 0,
      walletAttended: await showmark.hasAttended(eventId, wallet.address),
      walletPresenceKey: await showmark.presenceKeyOf(wallet.address),
      linkedPass: await showmark.passOf(wallet.address),
      walletAttendedCount: await showmark.attendedCount(wallet.address, [eventId, eventId + 1n]),
    };
  } finally {
    relayer?.close();
    anvil.process.kill();
  }
}

if (import.meta.main) {
  const result = await runEndToEnd();
  console.log(`registry      ${result.registry}`);
  console.log(`event         ${result.eventId}, ${result.checkedIn} checked in`);
  console.log(`mode 1        ${result.attendeeA} attended=${result.modeOne.attended} mode=${result.modeOne.mode}`);
  console.log(`mode 2        ${result.attendeeB} attended=${result.modeTwo.attended} mode=${result.modeTwo.mode}`);
  console.log(`streak        current=${result.streak.current} best=${result.streak.best}`);
  console.log(`linked wallet ${result.wallet} attended=${result.walletAttended}`);
  console.log(`lens          wallet resolves to ${result.walletPresenceKey}, attended ${result.walletAttendedCount} of 2 listed events`);
}
