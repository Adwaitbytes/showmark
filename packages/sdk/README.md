# @showmark/sdk

TypeScript client and React components for Showmark, presence-conditional sponsorship on the QIE blockchain. Sponsors lock QIE or QUSDC in escrow, organizers run real events with a rotating signed door QR, attendees check in without gas, and each verified presence pays out to the organizer and the attendee.

This package gives you every signature Showmark uses, the door QR codec, typed chain reads, the gasless relayer and three React components. It runs in browsers and Node with any viem account.

```bash
pnpm add @showmark/sdk viem
```

## Check in

```ts
import { ShowmarkClient } from "@showmark/sdk";

const showmark = new ShowmarkClient({ chain: 1983, addresses: { registry }, relayUrl: "https://showmark.app" });

// doorPass is the URL the phone camera opened, or the bare token
const { txHash } = await showmark.checkIn({ doorPass, signer: passKey });
await showmark.waitForTx(txHash);
```

## Read presence

```ts
await showmark.hasAttended(42n, "0x...");   // true for the pass or its linked wallet
await showmark.presenceOf(42n, "0x...");    // { present, mode, at }
await showmark.streakOf(3n, "0x...");       // { current, best }
await showmark.quote(7n);                   // what one presence pays right now
```

## Sign

```ts
import { createDoorPass, doorPassUrl, signCheckIn, signLinkWallet } from "@showmark/sdk";

const domain = { chainId: 1983, registry };
const url = doorPassUrl("https://showmark.app", await createDoorPass({ ...domain, signer: doorKey, eventId: 42n }));
const sig = await signCheckIn({ ...domain, signer: passKey, eventId: 42n });
```

`CheckIn`, `DoorPass`, `DoorAttest` and `LinkWallet` are each covered by a typed-data builder, a hash helper and a signer. The digests and signatures are tested against a Solidity implementation run by Foundry, and the real `ShowmarkRegistry` accepts them on anvil.

## React

```tsx
import { CheckInButton, DoorQR, PresenceBadge } from "@showmark/sdk/react";

<CheckInButton doorPass={token} account={passKey} relayUrl="https://showmark.app" chainId={1983} registry={registry} />
<PresenceBadge client={showmark} eventId={42n} account={address} />
<DoorQR doorKey={doorKey} eventId={42n} chainId={1983} registry={registry} origin="https://showmark.app" />
```

Unstyled, with `className` hooks, `data-state` for CSS and accessible markup.

## Solidity

Gate any QIE contract on real-world presence with `IPresence`:

```solidity
if (!presence.hasAttended(eventId, msg.sender)) revert NotPresent();
address key = presence.presenceKeyOf(msg.sender); // one claim per person, pass or wallet
```

## Errors

Everything thrown is a `ShowmarkError` with a `code`: `CONFIG`, `INVALID_INPUT`, `SIGNING`, `NETWORK`, `RELAY` (with the relayer's `message` and `action`) or `CONTRACT` (with `revertName`).

## More

The full reference, the React and Solidity guides and the MCP server setup are in `docs/SDK.md` in the Showmark repository. Runnable examples live in `packages/sdk/examples` there; run them all with `pnpm --filter @showmark/sdk examples` after a build.
