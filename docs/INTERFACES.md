# Interfaces

This file is the contract between workstreams. Build against it exactly. If something here is wrong or missing, say so in your final report instead of silently diverging; the lead changes this file.

Product name: **Showmark**. EIP-712 domain name `"Showmark"`, version `"1"`.

## 0. Repository layout and ownership

```
apps/web/                      Next.js App Router app (one deployable)
  src/app/(public)/            landing, events, passport pages, traction, docs     -> C
  src/app/(attendee)/          /pass, /scan, /check-in/[...], /me                  -> D
  src/app/(organizer)/         /organize/**, /door/[eventId]                        -> E
  src/app/(sponsor)/           /sponsor/**                                          -> F
  src/app/api/                 route handlers                                       -> B
  src/server/                  relayer, indexer, db, auth, rate limits              -> B
  src/ui/                      design system primitives, tokens, patterns, stamp    -> C
  src/lib/chain/               chain config, ABIs, addresses, viem clients          -> lead
  src/lib/wallet/              EIP-6963 QIE Wallet store, pass key, signing         -> D (lead reviews)
  src/lib/copy/                shared copy strings (en, hi)                         -> C
packages/contracts/            Foundry project                                      -> A
packages/sdk/                  @showmark/sdk TypeScript client + React components   -> G
packages/mcp/                  read-only MCP server                                 -> G
docs/                          lead, plus I for launch-kit files
```

Agents never edit files outside their ownership. Shared needs go in the final report.

## 1. Chains and external addresses

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 1990 | 1983 |
| RPC | https://rpc1mainnet.qie.digital ... rpc5mainnet | https://rpc1testnet.qie.digital |
| Explorer | https://mainnet.qie.digital (Blockscout, /api/v2) | https://testnet.qie.digital |
| QUSDC (6 dp) | 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 | MockQUSDC (deployed by us) |
| QIE ID (Zone, ERC-721) | 0x9aab56e7727af53A3131985BFB16d845319b7bdc | MockZone (deployed by us) |
| QIE/USDT oracle (8 dp) | 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17 | MockAggregator (deployed by us) |
| QIEDEX router (UniV2) | 0x08cd2e72e156D8563B4351eb4065C262A9f553Ef | none |
| WQIE | 0x0087904D95BEe9E5F24dc8852804b547981A9139 | none |

Compiler: Solidity 0.8.x latest stable, `evm_version = "shanghai"`, optimizer on (runs 10_000 for registry, 200 elsewhere is fine). No transient storage. OpenZeppelin Contracts 5.6.x as a dependency only.

## 2. Contracts

All contracts are immutable (no proxies), `Ownable2Step` where an owner exists, ownership transferred to the protocol Safe after deployment.

### 2.1 Proof modes

| Mode | Value | Door signs | Freshness rule |
|---|---|---|---|
| Rotating door QR | 1 | `DoorPass(eventId, issuedAt)`, rotated every 15 s on the door screen | `issuedAt <= block.timestamp + 30` and `block.timestamp <= issuedAt + event.maxPassAge` |
| Door scans you | 2 | `DoorAttest(eventId, attendee, attestedAt)`, bound to one attendee | `attestedAt` inside `[startsAt - 1 hours, endsAt + 1 hours]` and `attestedAt <= block.timestamp + 30`; submittable until `endsAt + 3 days` (offline queue) |

Higher value is stronger. A campaign's `minProofMode` decides which presences it pays for.

### 2.2 EIP-712 types (verifyingContract = ShowmarkRegistry)

```
CheckIn(uint256 eventId,address attendee,uint8 mode)            signed by the attendee pass key (mode is bound, audit M-01)
DoorPass(uint256 eventId,uint64 issuedAt,address ticket)         signed by an authorized door key (mode 1)
Ticket(uint256 eventId,address attendee)                         signed by the ephemeral ticket key shown only inside the QR (mode 1)
DoorAttest(uint256 eventId,address attendee,uint64 attestedAt)   signed by an authorized door key (mode 2)
LinkWallet(address pass,address wallet,uint64 deadline)          signed by BOTH the pass key and the wallet (wallet may be ERC-1271)
```

Replay: domain separator binds chain and contract; `eventId` binds the event; one presence per (event, attendee) makes a replayed CheckIn a no-op rejection.

Ticket keys (audit C-01): every 15 s rotation the door screen generates a fresh throwaway key, signs its address inside `DoorPass`, and puts the ticket private key in the QR. A mode 1 check-in must carry a `Ticket` signature from that key over the specific attendee. Calldata only ever shows signatures, never the ticket private key, so a door pass read from the chain cannot admit anyone else. Seeing the QR is required, which leaves screen streaming as the documented residual risk.

### 2.3 ShowmarkRegistry

Records organizers' events, door keys, presence, streaks, pass-to-wallet links. Never calls the vault.

```solidity
struct EventInfo {
  address organizer;
  uint64 startsAt;
  uint64 endsAt;
  uint32 capacity;        // 0 = unlimited
  uint32 checkedIn;
  uint32 maxPassAge;      // seconds, 30..600, mode 1 freshness
  uint64 seriesId;        // 0 = none; series ids are allocated by createSeries
  uint32 seriesIndex;     // 1-based position inside the series, 0 if no series
}
struct Presence { uint8 mode; uint64 at; }   // at = block.timestamp of record; mode 0 = absent

function createSeries(string calldata metadata) external returns (uint64 seriesId);                       // emits SeriesCreated
function createEvent(uint64 startsAt, uint64 endsAt, uint32 capacity, uint32 maxPassAge, uint64 seriesId, string calldata metadata) external returns (uint256 eventId);
function updateEventMetadata(uint256 eventId, string calldata metadata) external;                           // organizer only
function setCapacity(uint256 eventId, uint32 capacity) external;                                           // organizer only, >= checkedIn
function authorizeDoorKey(uint256 eventId, address key, uint64 validUntil) external;                       // organizer only, validUntil <= endsAt + 3 days
function revokeDoorKey(uint256 eventId, address key) external;                                              // organizer only
function checkIn(CheckInData calldata d) external returns (bool recorded);                                  // reverts with a typed error on failure
function checkInBatch(CheckInData[] calldata ds) external returns (uint8[] memory status);                 // never reverts per item; status codes below
function linkWallet(address pass, address wallet, uint64 deadline, bytes calldata passSig, bytes calldata walletSig, uint256[] calldata relocateEventIds) external;
function pause() / unpause()                                                                                 // owner; blocks createEvent, checkIn*, linkWallet

struct CheckInData {
  uint256 eventId;
  address attendee;
  uint8 mode;            // 1 or 2
  uint64 doorTime;       // issuedAt (mode 1) or attestedAt (mode 2)
  address ticket;        // mode 1: ticket key address signed in DoorPass; mode 2: address(0)
  bytes attendeeSig;     // CheckIn(eventId, attendee, mode)
  bytes doorSig;         // DoorPass or DoorAttest
  bytes ticketSig;       // mode 1: Ticket(eventId, attendee) by the ticket key; mode 2: empty
}

// views
function eventInfo(uint256 eventId) external view returns (EventInfo memory);
function presenceOf(uint256 eventId, address attendee) external view returns (Presence memory);
function hasAttended(uint256 eventId, address account) external view returns (bool);  // resolves wallet -> pass
function streakOf(uint64 seriesId, address pass) external view returns (uint32 current, uint32 best);
function doorKeyValidUntil(uint256 eventId, address key) external view returns (uint64);
function walletOf(address pass) external view returns (address);   // 0 if unlinked
function passOf(address wallet) external view returns (address);   // 0 if unlinked
function nextEventId() external view returns (uint256);              // ids start at 1
function stamp() external view returns (address);                    // the PresenceStamp, deployed by the registry constructor
```

Batch status codes (`uint8`): `0 Recorded, 1 AlreadyPresent, 2 UnknownEvent, 3 BadAttendeeSig, 4 BadDoorSig, 5 DoorKeyNotAuthorized, 6 Stale, 7 OutsideEventWindow, 8 AtCapacity, 9 BadMode, 10 Paused`.

Rules:
- Check-in is accepted only inside `[startsAt - 1 hours, endsAt + 1 hours]` by block time for mode 1, and by `attestedAt` for mode 2.
- A door key must have `validUntil >= doorTime` and must have been authorized for that event by its organizer.
- Streak: when an event has `seriesId != 0`, recording presence at `seriesIndex = n` sets `current = (lastIndex == n - 1) ? current + 1 : 1`, updates `best`. Track `lastIndex` per (series, pass).
- Presence is keyed by pass address forever. `linkWallet` sets `walletOf[pass]` and `passOf[wallet]` once each (both must be unset), and moves the listed stamps from pass to wallet through `PresenceStamp.relocate`.
- `hasAttended(eventId, account)` checks `account` and `passOf[account]`.

Events:
```
SeriesCreated(uint64 indexed seriesId, address indexed organizer, string metadata)
EventCreated(uint256 indexed eventId, address indexed organizer, uint64 startsAt, uint64 endsAt, uint32 capacity, uint32 maxPassAge, uint64 indexed seriesId, uint32 seriesIndex, string metadata)
EventMetadataUpdated(uint256 indexed eventId, string metadata)
CapacityChanged(uint256 indexed eventId, uint32 capacity)
DoorKeyAuthorized(uint256 indexed eventId, address indexed key, uint64 validUntil)
DoorKeyRevoked(uint256 indexed eventId, address indexed key)
CheckedIn(uint256 indexed eventId, address indexed attendee, uint8 mode, address doorKey, uint64 doorTime, uint32 streak)
CheckInRejected(uint256 indexed eventId, address indexed attendee, uint8 status)
WalletLinked(address indexed pass, address indexed wallet)
```

Event metadata string is JSON: `{"v":1,"name":string,"venue":string,"city":string,"description":string,"url"?:string}`. Max 2,048 bytes, enforced on-chain by length.

### 2.4 PresenceStamp (ERC-1155, non-transferable)

- Token id = eventId. Deployed by the registry; only the registry mints and relocates.
- `safeTransferFrom`, `safeBatchTransferFrom`, `setApprovalForAll` revert with `Soulbound()`.
- `uri(id)` returns `{baseURI}{id}` where baseURI is set by owner (points at `/api/stamp/{id}` JSON metadata served by the app). Owner can change baseURI only.
- `name() = "Showmark stamps"`, `symbol() = "STAMP"`.

### 2.5 CampaignVault

Sponsor escrow, settlement per presence, splits, fee, refunds, oracle pricing. Reads the registry, the Zone contract and the oracle. Pull payments.

```solidity
enum Pricing { Token, UsdInNative }   // Token: amountPerPresence in token units. UsdInNative: amountPerPresence in USD with 6 decimals, paid in native QIE at oracle price.

struct CampaignParams {
  address token;            // address(0) = native QIE. Must be address(0) when pricing == UsdInNative.
  Pricing pricing;
  uint128 amountPerPresence;
  uint16 attendeeShareBps;  // 0..10000, of the amount after fee; the rest goes to the organizer
  uint8 minProofMode;       // 1 or 2
  bool requireQieId;        // attendee pass must be linked to a wallet with Zone.balanceOf > 0
  uint64 startsAt;
  uint64 endsAt;
  uint32 maxPerEvent;       // 0 = unlimited
  uint32 maxTotal;          // 0 = unlimited
  bool openToBonded;        // any organizer with bond >= minBond may be paid without per-event approval
  uint128 minBond;
  string metadata;          // JSON {"v":1,"name":string,"sponsor":string,"description":string,"url"?:string}, max 2048 bytes
}

function createCampaign(CampaignParams calldata p, uint256 deposit) external payable returns (uint256 campaignId); // native: msg.value == deposit; ERC-20: transferFrom, credited by balance delta
function topUp(uint256 campaignId, uint256 amount) external payable;      // anyone may top up
function approveEvents(uint256 campaignId, uint256[] calldata eventIds) external;   // sponsor only
function revokeEvents(uint256 campaignId, uint256[] calldata eventIds) external;    // sponsor only; already settled payouts stand
function closeCampaign(uint256 campaignId) external;                     // sponsor only; sets endsAt = min(endsAt, now)
function settle(uint256 campaignId, uint256 eventId, address attendee) external returns (uint256 paid);   // reverts with typed error
function settleBatch(SettleItem[] calldata items) external returns (uint8[] memory status);             // never reverts per item
function refund(uint256 campaignId) external;                           // sponsor only, after endsAt + SETTLE_GRACE (3 days); works when paused
function withdraw(address token, address account) external;              // anyone; pays claimable[token][account] to walletOf(account) if linked else account; works when paused
function setFee(uint16 bps, address recipient) external;                 // owner; bps <= MAX_FEE_BPS = 500; snapshotted into new campaigns only
function pause() / unpause()                                              // owner; blocks createCampaign and settle*, never refund/withdraw

struct SettleItem { uint256 campaignId; uint256 eventId; address attendee; }

// views
function campaign(uint256 id) external view returns (Campaign memory);
function claimable(address token, address account) external view returns (uint256);
function isApproved(uint256 campaignId, uint256 eventId) external view returns (bool);
function isSettled(uint256 campaignId, uint256 eventId, address attendee) external view returns (bool);
function quote(uint256 campaignId) external view returns (uint256 amountInToken, bool priceFresh);   // what one presence pays right now
function totalLiabilities(address token) external view returns (uint256);   // sum of campaign balances + claimables; used by the solvency invariant
```

Settlement rules, in order (batch status in brackets):
`0 Settled`, `1 AlreadySettled`, `2 UnknownCampaign`, `3 NotPresent` (no presence or mode < minProofMode), `4 OutsideCampaignWindow` (presence.at not in [startsAt, endsAt]), `5 EventNotEligible` (not approved and not (openToBonded and bond >= minBond)), `6 EventCapReached`, `7 TotalCapReached`, `8 NeedsQieId` (requireQieId and not (walletOf(pass) != 0 and Zone.balanceOf(wallet) > 0)), `9 PriceStale` (oracle older than MAX_ORACLE_AGE or answer <= 0), `10 InsufficientBudget`, `11 SettlementClosed` (now > endsAt + SETTLE_GRACE), `12 Paused`.

Payout: `gross = amountInToken`; `fee = gross * feeBps / 10000`; `net = gross - fee`; `toAttendee = net * attendeeShareBps / 10000`; `toOrganizer = net - toAttendee`. Credit claimables, decrement campaign balance by `gross`. Organizer is `registry.eventInfo(eventId).organizer`.

Constructor: `(registry, zone, oracle, bond, maxOracleAge, owner, feeRecipient, feeBps)`. All immutable except fee.

Events:
```
CampaignCreated(uint256 indexed campaignId, address indexed sponsor, address indexed token, uint8 pricing, uint128 amountPerPresence, uint16 attendeeShareBps, uint8 minProofMode, bool requireQieId, uint64 startsAt, uint64 endsAt, uint16 feeBps, string metadata)
CampaignFunded(uint256 indexed campaignId, address indexed from, uint256 amount)
EventsApproved(uint256 indexed campaignId, uint256[] eventIds)
EventsRevoked(uint256 indexed campaignId, uint256[] eventIds)
CampaignClosed(uint256 indexed campaignId, uint64 endsAt)
Settled(uint256 indexed campaignId, uint256 indexed eventId, address indexed attendee, address organizer, uint256 gross, uint256 toAttendee, uint256 toOrganizer, uint256 fee, uint256 price)
SettlementSkipped(uint256 indexed campaignId, uint256 indexed eventId, address indexed attendee, uint8 status)
Refunded(uint256 indexed campaignId, address indexed sponsor, uint256 amount)
Withdrawn(address indexed token, address indexed account, address indexed to, uint256 amount)
FeeChanged(uint16 bps, address recipient)
```

### 2.6 OrganizerBond

Organizers stake native QIE. Sponsors may open a campaign to any bonded organizer. The arbitrator (protocol Safe) resolves challenges. Arbitration is centralized in v1 and the docs say so.

```solidity
function bond() external payable;                                   // adds to msg.sender's bond
function requestUnbond(uint256 amount) external;                    // starts UNBOND_DELAY (7 days); bonded amount drops immediately for eligibility
function completeUnbond() external;                                 // after delay; pull to msg.sender
function challenge(address organizer, uint256 campaignId, string calldata reason) external returns (uint256 challengeId);  // sponsor of campaignId only
function resolve(uint256 challengeId, uint256 slashAmount, address recipient) external;  // arbitrator only; slashes from bonded + pending unbond
function bondOf(address organizer) external view returns (uint256);
```
Events: `Bonded`, `UnbondRequested`, `Unbonded`, `Challenged`, `Resolved`.

### 2.7 PresenceLens and IPresence

`IPresence` is the interface any QIE contract can use to gate on real-world presence:
```solidity
interface IPresence {
  function hasAttended(uint256 eventId, address account) external view returns (bool);
  function attendedCount(address account, uint256[] calldata eventIds) external view returns (uint256);
  function streakOf(uint64 seriesId, address account) external view returns (uint32 current, uint32 best);
}
```
`PresenceLens` implements it over the registry (resolving wallet -> pass). `examples/PresenceGatedMint.sol`: a minimal contract that lets an account claim one thing per event attended, as the SDK example.

### 2.8 Invariant tests required (Foundry)

1. Presence recorded at most once per (event, attendee).
2. No vault state can make `checkIn` revert (registry has no vault dependency; prove with a test that checks in while vault is paused, broke, or oracle stale).
3. For every token: `balance(vault) >= totalLiabilities(token)`, and `totalLiabilities == sum(campaign balances) + sum(claimables)`.
4. Sponsor can always refund after `endsAt + SETTLE_GRACE`, including when paused.
5. Only a door key authorized by the event's organizer within its validity window can attest.
6. Signatures do not replay across events, contracts or chains.
7. Fee never exceeds MAX_FEE_BPS.
8. Reentrancy: native payouts to a malicious receiver cannot drain or double-claim.
9. No upgradeability. Pause never blocks refund or withdraw.
10. Stale or non-positive oracle price defers settlement (status 9) and never misprices.

## 3. Relayer and API (Next.js route handlers, Node runtime)

All bodies validated with zod. Errors return `{ error: { code: string, message: string, action: string } }` where `message` says what happened and `action` says what to do next, in plain words.

| Route | Method | Body / query | Returns |
|---|---|---|---|
| `/api/relay/check-in` | POST | `CheckInData` (hex strings, bigint as decimal string) | `{ txHash, status: "submitted" }` after simulation passes; `422` with status code mapped to copy if simulation fails |
| `/api/relay/check-in/batch` | POST | `{ items: CheckInData[] }` max 50 (door-scans-you offline queue) | `{ txHash, accepted: number }` |
| `/api/relay/link-wallet` | POST | `{ pass, wallet, deadline, passSig, walletSig, relocateEventIds }` | `{ txHash }` |
| `/api/relay/withdraw` | POST | `{ token, account }` | `{ txHash }` |
| `/api/tx/[hash]` | GET | | `{ status: "pending" | "success" | "reverted", blockNumber? }` |
| `/api/events` | GET | `?organizer=&upcoming=1` | indexed events with parsed metadata and counts |
| `/api/events/[id]` | GET | | event, metadata, checkedIn, campaigns paying for it |
| `/api/passport/[addressOrName]` | GET | `name.qie` or address | pass, wallet, qieName, stamps[], streaks, claimable per token |
| `/api/campaigns` | GET | `?sponsor=` | campaigns with balances and settled counts |
| `/api/campaigns/[id]` | GET | | campaign, approved events, settlements with tx hashes |
| `/api/campaigns/[id]/report` | GET | `?format=csv|json` | sponsor report |
| `/api/traction` | GET | | numbers in section 6 |
| `/api/stamp/[id]` | GET | | ERC-1155 metadata JSON with an SVG image |
| `/api/auth/nonce`, `/api/auth/verify`, `/api/auth/session` | | SIWE-style sign-in with QIE Wallet | short-lived httpOnly session cookie (15 min sliding, 12 h max) |
| `/api/dex/quote` | GET | proxies api.dex.qie.digital /quote with caching and rate limit | |
| `/api/cron/sync` | GET | indexer catch-up, protected by `CRON_SECRET` | |

Relayer rules: relays only to registry and vault addresses; simulates with `eth_call` first; per-IP and per-pass rate limits in Upstash (10 check-ins per minute per IP, 3 per minute per pass); serializes nonces with a Redis lock (`SET NX PX 5000`), micro-batches pending check-ins under the lock into `checkInBatch`; after a check-in tx is sent it immediately sends `vault.settleBatch` for every campaign approved for that event with the next nonce; alerts (structured log `level=warn`) when relayer balance < 5 QIE.

Indexer: viem `fallback` transport over rpc1..rpc5. Reads logs from the deploy block in chunks (probe max range), stores in Postgres, catches up on every read with a short lock so it does not depend on a paid scheduler.

## 4. Database (Neon Postgres, Drizzle)

```
sync_state(chain_id int, contract text, last_block bigint, primary key(chain_id, contract))
events(id bigint pk, organizer text, starts_at timestamptz, ends_at timestamptz, capacity int, checked_in int, max_pass_age int, series_id bigint, series_index int, name text, venue text, city text, description text, url text, created_block bigint, created_tx text)
presences(event_id bigint, attendee text, mode smallint, door_key text, door_time timestamptz, streak int, block bigint, tx text, at timestamptz, primary key(event_id, attendee))
links(pass text pk, wallet text unique, block bigint, tx text)
campaigns(id bigint pk, sponsor text, token text, pricing smallint, amount_per_presence numeric, attendee_share_bps int, min_proof_mode smallint, require_qie_id bool, starts_at timestamptz, ends_at timestamptz, fee_bps int, name text, sponsor_name text, description text, team_funded bool, created_tx text)
campaign_events(campaign_id bigint, event_id bigint, approved bool, primary key(campaign_id, event_id))
settlements(campaign_id bigint, event_id bigint, attendee text, organizer text, gross numeric, to_attendee numeric, to_organizer numeric, fee numeric, price numeric, block bigint, tx text, at timestamptz, primary key(campaign_id, event_id, attendee))
fundings(campaign_id bigint, from_addr text, amount numeric, block bigint, tx text, log_index int, primary key(tx, log_index))
withdrawals(token text, account text, to_addr text, amount numeric, block bigint, tx text, log_index int, primary key(tx, log_index))
profiles(address text pk, qie_name text, first_seen_block bigint, first_seen_via_showmark bool, updated_at timestamptz)
door_queue(id text pk, event_id bigint, payload jsonb, received_at timestamptz, submitted_tx text)
```
`team_funded` is true when the sponsor address is in `TEAM_ADDRESSES` env (comma separated). Traction separates team-funded and external.

## 5. Design tokens (locked by C at Gate 1)

```
--paper:        #F3EFE6   page background
--paper-deep:   #E9E3D6   insets, perforation shadows
--ink:          #141311   text, rules, primary marks
--ink-soft:     #4A4640   secondary text (AA on paper)
--vermilion:    #E4442B   the one accent, used sparingly (primary action, the check-in stamp)
--stamp-blue:   #2B4BD9   secondary marks, links on data
--ledger-green: #1F6B45   success
--night:        #12110F   dark theme background ("night desk"), same inks inverted
Fonts: Instrument Serif (display), Geist (interface), Geist Mono (addresses, amounts, hashes)
Type scale (rem): 0.75, 0.875, 1, 1.125, 1.375, 1.75, 2.25, 3, 4, 5.5
Spacing: 4 px base, steps 1 2 3 4 6 8 12 16 24 32
Radius: 2 px (documents), 999 px (pills only)
Motion: stamp press 180 ms cubic-bezier(.2,1.4,.4,1); page view transitions 220 ms; honor prefers-reduced-motion
```
Signature elements: guilloche pattern seeded by address (`src/ui/patterns/guilloche.tsx`, deterministic SVG), stamps with seeded rotation and SVG ink-bleed filter (`src/ui/stamp/Stamp.tsx`), perforated edges (`src/ui/Perforation.tsx`), paper grain (CSS, SVG noise).

## 6. Traction numbers (`/api/traction`)

verified attendees (distinct passes with presence), events with at least one check-in, organizers, sponsors (team-funded vs external), value settled per token and in USD at current oracle price, new wallets first seen through Showmark, passes linked to QIE Wallet (conversion rate), attendees whose wallet holds a QIE ID, people with two or more events, Showmark transaction count, share of chain daily transactions (Blockscout `/api/v2/stats`).

## 7. Copy rules

Plain words, sentence case, specific numbers. No em or en dashes, no emoji, no exclamation marks, no clipped fragments. Banned: seamless, revolutionize, unlock, empower, leverage, cutting-edge, next-generation, game-changing, effortless, supercharge, reimagine, "the future of", "Web3 made simple", "in today's world". Every error says what happened and what to do next.

## 8. QR payloads (`apps/web/src/lib/qr/payload.ts`, mirrored by the SDK)

- Door pass (mode 1): `{origin}/c/{eventId}.{issuedAt}.{doorSig base64url}.{ticketKey base64url}` (ticketKey is the 32 byte ephemeral private key; its address is derived, not transmitted). Any phone camera opens it straight into the attendee app at `/c/[token]`. The door screen re-signs every 15 seconds.
- Attendee code (mode 2): `SM2.{eventId}.{attendee}.{attendeeSig base64url}`, shown in the attendee app and scanned by the door app.
- Signatures are 65 bytes. Decoders return null on any malformed input and never throw.

## 9. Server query functions

Server components call `apps/web/src/server/queries.ts` directly (owned by B) instead of going through HTTP. Each function returns the matching type in `src/lib/api/types.ts`: `getTraction()`, `listEvents(filter)`, `getEvent(id)`, `getPassport(addressOrName)`, `listCampaigns(filter)`, `getCampaign(id)`. Client components use the `/api/*` routes.
