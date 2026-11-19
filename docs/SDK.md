# Showmark SDK, embeds and MCP server

Showmark records verified real-world presence on QIE and pays sponsors' escrow out per presence. Four pieces let other apps build on that record:

| Piece | What it gives you |
|---|---|
| `@showmark/sdk` | A TypeScript client for QIE mainnet (1990) and testnet (1983): EIP-712 signers for every Showmark signature, the door QR codec, chain reads, the gasless relayer, typed errors. Works in browsers and Node with any viem account. |
| `@showmark/sdk/react` | Three unstyled components: `CheckInButton`, `PresenceBadge` and `DoorQR`. |
| `IPresence` | A four-function Solidity interface any QIE contract can call to gate on real-world presence. |
| `@showmark/mcp` | A read-only MCP server so agents can query verified reach, campaigns, events, passports and presence. Hosted at `/api/mcp` on the Showmark site, or run locally over stdio or HTTP. |

The snippets below are cut from files in `packages/sdk/examples`, which run against the built package with `pnpm --filter @showmark/sdk examples` (the React file type-checks with the package). Each section names its file, and the last section says how the rest is verified.

## Install

```bash
pnpm add @showmark/sdk viem
# React components also need react 18 or 19
```

The packages are not on npm yet. Inside this monorepo, depend on them with `"@showmark/sdk": "workspace:*"`. viem 2.58 or later is a peer dependency, so the SDK uses your copy.

## Check in from a scanned door pass

The door screen shows a QR that opens `https://<site>/c/{eventId}.{issuedAt}.{doorSig}`. The attendee's pass key signs `CheckIn`, and the relayer pays the gas.

```ts
import { ShowmarkClient } from "@showmark/sdk";
import { privateKeyToAccount } from "viem/accounts";

const showmark = new ShowmarkClient({
  chain: 1983,
  addresses: { registry: "0x...", vault: "0x..." },
  relayUrl: "https://showmark.app",
});
const passKey = privateKeyToAccount(storedPassKey); // the guest pass kept on the phone

const { txHash } = await showmark.checkIn({ doorPass: window.location.href, signer: passKey });
const { status } = await showmark.waitForTx(txHash); // "success" or "reverted"
```

`examples/anvil-end-to-end.ts` runs this exact flow against the real `ShowmarkRegistry` on a local chain.

## Reference

### Chains

```ts
import { qieMainnet, qieTestnet, explorerTxUrl } from "@showmark/sdk";

qieMainnet.id; // 1990, five public RPC endpoints, Blockscout at mainnet.qie.digital
explorerTxUrl(qieTestnet, "0xabc..."); // "https://testnet.qie.digital/tx/0xabc..."
```

Both are plain viem `Chain` objects, so they work with `createPublicClient` and `createWalletClient` directly.

### ShowmarkClient

```ts
const showmark = new ShowmarkClient({
  chain: 1990,                    // or 1983, or any viem Chain such as a local anvil
  addresses: { registry, vault, lens },
  relayUrl: "https://showmark.app", // only needed for relay calls
  // publicClient, rpcUrls and fetch are optional
});
```

Without `publicClient` the client reads through all public QIE RPC endpoints with failover. Addresses are checked when you create the client, and a missing address only fails the call that needs it, with `ShowmarkConfigError`.

Chain reads:

| Call | Returns |
|---|---|
| `getEvent(eventId)` | `{ organizer, startsAt, endsAt, capacity, checkedIn, maxPassAge, seriesId, seriesIndex }`, or `null` for an unknown id |
| `hasAttended(eventId, account)` | `true` when the account, or the pass linked to it, has a recorded presence |
| `presenceOf(eventId, pass)` | `{ present, mode, at }`, where mode 1 is the rotating door QR and mode 2 is door scans you |
| `streakOf(seriesId, account)` | `{ current, best }` |
| `attendedCount(account, eventIds)` | how many of the listed events the account attended (needs `lens`) |
| `presenceKeyOf(account)` | the pass that presence is keyed by; use it for one-per-person rewards (needs `lens`) |
| `passOf(wallet)` and `walletOf(pass)` | the other side of a pass-to-wallet link, or `null` |
| `getCampaign(campaignId)` | the stored campaign, or `null` |
| `quote(campaignId)` | `{ amount, priceFresh }`: what one presence pays right now |
| `claimable(token, account)` | withdrawable balance; zero address for native QIE |

```ts
if (await showmark.hasAttended(42n, "0x...")) {
  const { mode, at } = await showmark.presenceOf(42n, "0x...");
}
const { amount, priceFresh } = await showmark.quote(7n);
```

Relay calls go to the Showmark API (`/api/relay/*`, `/api/tx/*`). Bigints travel as decimal strings.

| Call | Sends |
|---|---|
| `checkIn({ doorPass, signer })` | signs `CheckIn` for a scanned door pass and relays it |
| `relayCheckIn(data)` | one `CheckInData`, after you built it yourself |
| `relayCheckInBatch(items)` | up to 50 check-ins, for the door-scans-you offline queue |
| `relayLinkWallet({ pass, wallet, deadline, passSig, walletSig, relocateEventIds })` | links a pass to a wallet |
| `relayWithdraw({ token, account })` | pays out claimable rewards to the linked wallet |
| `txStatus(hash)` and `waitForTx(hash)` | `{ status, blockNumber }` |

The same functions exist standalone (`relayCheckIn(options, data)` and so on) for code that has no client.

### EIP-712 signatures

Domain: name `Showmark`, version `1`, the chain id and the `ShowmarkRegistry` address. A signature never carries across chains, deployments or events.

| Type | Signed by | Helper |
|---|---|---|
| `CheckIn(uint256 eventId,address attendee)` | the attendee's pass key | `signCheckIn` |
| `DoorPass(uint256 eventId,uint64 issuedAt)` | a door key (mode 1) | `signDoorPass`, `createDoorPass` |
| `DoorAttest(uint256 eventId,address attendee,uint64 attestedAt)` | a door key (mode 2) | `signDoorAttest` |
| `LinkWallet(address pass,address wallet,uint64 deadline)` | both the pass key and the wallet | `signLinkWallet` |

A signer is any viem local account (`privateKeyToAccount`, `mnemonicToAccount`, `toAccount`), a smart account, or a wallet client with an account, such as QIE Wallet through EIP-1193.

```ts
import { createDoorPass, doorPassUrl, nowSeconds, signLinkWallet } from "@showmark/sdk";

const domain = { chainId: 1983, registry };
const pass = await createDoorPass({ ...domain, signer: doorKey, eventId: 42n }); // issuedAt = now
const url = doorPassUrl("https://showmark.app", pass);

const link = { pass: passKey.address, wallet: walletAddress, deadline: nowSeconds() + 600n };
const passSig = await signLinkWallet({ ...domain, ...link, signer: passKey });
const walletSig = await signLinkWallet({ ...domain, ...link, signer: walletClient });
```

`checkInTypedData`, `doorPassTypedData`, `doorAttestTypedData` and `linkWalletTypedData` return the full typed data for viem's `signTypedData`, `hashTypedData` or `recoverTypedDataAddress`. `hashCheckIn` and its siblings return the 32-byte digest the registry recovers against. Runnable: `examples/door-pass.ts`, `examples/link-wallet.ts`.

### QR codes

Byte-for-byte the same codec the Showmark app uses.

```ts
import { decodeDoorPass, encodeAttendeeCode, decodeAttendeeCode } from "@showmark/sdk";

decodeDoorPass("https://showmark.app/c/42.1795073006.q8vL...");
// { eventId: 42n, issuedAt: 1795073006n, doorSig: "0x..." }, or null for anything malformed

encodeAttendeeCode({ eventId: 42n, attendee, attendeeSig }); // "SM2.42.0xA8C8....{sig}"
```

Decoders never throw. Encoders throw `ShowmarkInputError` for a signature that is not 65 bytes.

### Building check-ins

```ts
import { buildDoorPassCheckIn, buildDoorAttestCheckIn, createAttendeeCode } from "@showmark/sdk";

// Mode 1, the attendee scanned the door screen
const data = await buildDoorPassCheckIn({ ...domain, doorPass: url, signer: passKey });

// Mode 2, the door scanned the attendee's SM2 code; works offline
const code = await createAttendeeCode({ ...domain, signer: passKey, eventId: 42n });
const attested = await buildDoorAttestCheckIn({ ...domain, attendeeCode: code, signer: doorKey });
```

Runnable: `examples/door-scans-you.ts`.

### Payouts and status codes

```ts
import { splitPayout, checkInStatusName, settleStatusName } from "@showmark/sdk";

splitPayout(2_000_000n, 200, 5_000); // 2 QUSDC, 2% fee, half to the attendee
// { gross: 2000000n, fee: 40000n, toAttendee: 980000n, toOrganizer: 980000n }
checkInStatusName(6); // "Stale"
settleStatusName(8);  // "NeedsQieId"
```

Integer math, so it matches the vault to the wei. Runnable: `examples/payout.ts`.

### Errors

Everything the SDK throws is a `ShowmarkError` with a `code`.

| Class | `code` | When |
|---|---|---|
| `ShowmarkConfigError` | `CONFIG` | a contract address or the relay URL is missing or invalid |
| `ShowmarkInputError` | `INVALID_INPUT` | a bad address or checksum, an out-of-range integer, a malformed code |
| `ShowmarkSigningError` | `SIGNING` | the account or wallet refused or failed to sign |
| `ShowmarkNetworkError` | `NETWORK` | no answer, a timeout, or a response in the wrong shape |
| `ShowmarkRelayError` | `RELAY` | the relayer refused; `message` says what happened and `action` what to do next, straight from the API |
| `ShowmarkContractError` | `CONTRACT` | a read reverted (`revertName` is set when it decodes) or no contract sits at the address |

```ts
try {
  await showmark.checkIn({ doorPass, signer: passKey });
} catch (error) {
  if (error instanceof ShowmarkRelayError) show(`${error.message} ${error.action}`);
  else throw error;
}
```

## React components

```tsx
import { CheckInButton, DoorQR, PresenceBadge } from "@showmark/sdk/react";

<CheckInButton doorPass={token} account={passKey} relayUrl="https://showmark.app" chainId={1983} registry={registry} />

<PresenceBadge client={showmark} eventId={42n} account={address} />

<DoorQR doorKey={doorKey} eventId={42n} chainId={1983} registry={registry} origin="https://showmark.app" size={480}>
  <figcaption>{count} checked in</figcaption>
</DoorQR>
```

The components ship no styles. Each takes `className` and the usual HTML attributes, and exposes its state as `data-state` for CSS:

| Component | `data-state` values | Accessibility |
|---|---|---|
| `CheckInButton` | `idle`, `signing`, `relaying`, `confirming`, `confirmed`, `failed` | a real `button` with `aria-busy`, plus a polite live region (`statusClassName`) that says what is happening and, on failure, what to do next |
| `PresenceBadge` | `loading`, `attended`, `absent`, `error` | `aria-busy` while loading; text labels by default, override with `labels` or a render function |
| `DoorQR` | `loading`, `ready`, `error` | a `figure` with an `img` whose `alt` says what the code is and how often it changes |

`CheckInButton` accepts the bare token or the full `/c/` URL, starts over when a new door pass arrives, and stops polling when it unmounts. `DoorQR` re-signs every 15 seconds by default (`intervalMs`) and never lets a slow signature replace a newer code. The React entry carries a `"use client"` directive, so it drops into the Next.js App Router. All three are in `examples/react-components.tsx`.

## Gate a contract on real-world presence

`PresenceLens` implements `IPresence` over the registry and resolves a wallet to its pass, so your contract can ask with whichever address calls it.

```solidity
interface IPresence {
    function hasAttended(uint256 eventId, address account) external view returns (bool);
    function attendedCount(address account, uint256[] calldata eventIds) external view returns (uint256);
    function streakOf(uint64 seriesId, address account) external view returns (uint32 current, uint32 best);
    function presenceKeyOf(address account) external view returns (address);
}
```

A perk anyone verified at an event can claim once:

```solidity
contract BuilderPerks {
    IPresence public immutable presence;
    uint256 public immutable eventId;
    mapping(address presenceKey => bool) public claimed;

    error NotPresent();
    error AlreadyClaimed();

    constructor(IPresence presence_, uint256 eventId_) {
        presence = presence_;
        eventId = eventId_;
    }

    function claim() external {
        if (!presence.hasAttended(eventId, msg.sender)) revert NotPresent();
        address key = presence.presenceKeyOf(msg.sender);
        if (claimed[key]) revert AlreadyClaimed();
        claimed[key] = true;
        // Mint, transfer or grant the perk here.
    }
}
```

Key claims by `presenceKeyOf`, not `msg.sender`: a pass and the wallet linked to it both pass `hasAttended`, and keying by the pass stops one person from claiming twice. The contract and its tests are in `packages/sdk/test/foundry` (`pnpm --filter @showmark/sdk test:sol`). Use `attendedCount` for "came to three of these five" and `streakOf` for "came to every session in a row".

## MCP server

A read-only server for agents, with seven tools. Amounts are integer strings in token base units (QIE has 18 decimals, QUSDC has 6), and every transaction comes with an explorer link.

| Tool | Answers |
|---|---|
| `showmark_traction` | network numbers, with team-funded and external sponsors kept apart |
| `showmark_list_events` | events, newest first or upcoming first, filterable by organizer |
| `showmark_get_event` | one event, its paying campaigns and recent check-ins, cross-checked against the registry |
| `showmark_get_campaign` | one campaign's terms, balance and approved events, with the vault's live quote |
| `showmark_verified_reach` | every presence a campaign paid for, with totals, distinct attendees and explorer links |
| `showmark_get_passport` | an attendee's stamps, streaks and claimable rewards, by address or `.qie` name |
| `showmark_has_attended` | a direct answer from `ShowmarkRegistry` for one account at one event |

Hosted, nothing to install:

```bash
claude mcp add --transport http showmark https://<site>/api/mcp
```

Local over stdio, from this repository:

```bash
pnpm --filter @showmark/sdk build && pnpm --filter @showmark/mcp build
claude mcp add showmark \
  --env SHOWMARK_API_URL=https://<site> \
  --env SHOWMARK_CHAIN_ID=1990 \
  --env SHOWMARK_REGISTRY_ADDRESS=0x... \
  -- node /path/to/repo/packages/mcp/dist/cli.js
```

For Claude Desktop or Cursor, the same command goes in the config file:

```json
{
  "mcpServers": {
    "showmark": {
      "command": "node",
      "args": ["/path/to/repo/packages/mcp/dist/cli.js"],
      "env": { "SHOWMARK_API_URL": "https://<site>", "SHOWMARK_REGISTRY_ADDRESS": "0x..." }
    }
  }
}
```

Local over HTTP: `node packages/mcp/dist/cli.js --http --port 3333` serves `http://127.0.0.1:3333/mcp`. On loopback it refuses foreign `Host` headers, so a web page cannot reach it through DNS rebinding.

| Variable | Meaning |
|---|---|
| `SHOWMARK_API_URL` | the Showmark site, for indexed data |
| `SHOWMARK_CHAIN_ID` | `1990` (default) or `1983` |
| `SHOWMARK_REGISTRY_ADDRESS` | for on-chain presence reads |
| `SHOWMARK_VAULT_ADDRESS` | for live quotes |
| `SHOWMARK_LENS_ADDRESS` | optional |
| `SHOWMARK_RPC_URL` | optional, comma-separated |

Every variable is optional, and a tool that needs a missing one answers with what to set instead of failing silently. The hosted route reads the app's own data and contract addresses, so it needs no variables. To embed the server elsewhere, `createShowmarkMcpServer(options)` returns the server and `handleMcpRequest(request, options)` answers one stateless Streamable HTTP request on any runtime with `Request` and `Response`.

## How this is verified

- Typed data and signatures. `test/foundry/script/Digests.s.sol` computes the EIP-712 digests in Solidity, with `abi.encode` and `keccak256`, for fixed inputs on both chain ids, including zero and maximum values, and signs them with Foundry's `vm.sign`. The vitest suite checks that viem produces the same digests and the same 65-byte signatures, and checks both against a third implementation built from `keccak256` and `encodeAbiParameters`. Then `test/anvil.test.ts` deploys the real `ShowmarkRegistry` to anvil and records presences in both proof modes and a wallet link from SDK signatures, so the contract itself accepts what the SDK signs.
- QR codec. The tests run the SDK codec and `apps/web/src/lib/qr/payload.ts` side by side on 500 random payloads and 2,000 mutated strings and require identical output, including every rejection.
- Client reads decode real ABI-encoded results through a mocked viem transport; reverts, empty data and transport failures map to the documented errors.
- ABIs come from the contracts. `pnpm --filter @showmark/sdk sync-abi` regenerates `src/abi/*.ts` from `packages/contracts/abi/*.json` when the contracts workstream exports them, and otherwise from a fresh `forge build` of `packages/contracts`. It moves from `ICampaignVault` and `IPresence` to `CampaignVault` and `PresenceLens` as those contracts land.
- MCP tools run through the official MCP client over an in-memory transport, the stateless HTTP handler, the standalone HTTP server and stdio.

```bash
pnpm --filter @showmark/sdk build
pnpm --filter @showmark/sdk test        # vitest, includes the anvil run when Foundry is installed
pnpm --filter @showmark/sdk typecheck
pnpm --filter @showmark/sdk examples    # runs every example against the built package
pnpm --filter @showmark/sdk test:sol    # the IPresence example
pnpm --filter @showmark/mcp build && pnpm --filter @showmark/mcp test
```
