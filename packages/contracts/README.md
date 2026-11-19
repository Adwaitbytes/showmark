# Showmark contracts

Presence-conditional sponsorship on QIE. A sponsor locks QIE or QUSDC in escrow, an organizer runs a real event
with a rotating signed door QR, attendees check in gaslessly through a relayer and receive a non-transferable
stamp, and each verified presence releases part of the escrow to the organizer and the attendee. Whatever is not
spent goes back to the sponsor.

The contracts are original, immutable (no proxies) and small. OpenZeppelin Contracts is used as a dependency only.
Development was AI-assisted; every line was written for this project.

## Contracts

| Contract | What it does | Runtime size |
|---|---|---|
| `ShowmarkRegistry` | Events, series, door keys, check-ins (single and batched), streaks and pass-to-wallet links. Verifies the attendee's `CheckIn` (which binds the proof mode), the door's `DoorPass` or `DoorAttest`, and for mode 1 the rotation ticket's `Ticket` EIP-712 signatures (domain `Showmark`, version `1`). Never calls the vault. Deploys the stamp in its constructor. | 15,387 B |
| `PresenceStamp` | Soulbound ERC-1155, token id = event id. Only the registry mints and relocates; transfers and approvals revert with `Soulbound()`. `uri(id)` is `{baseURI}{id}`. | 6,323 B |
| `CampaignVault` | Sponsor escrow. Pays per verified presence in a token amount or in USD converted to QIE at the oracle price, splits fee, attendee and organizer shares into claimable balances, and refunds the rest after the grace period. | 17,244 B |
| `OrganizerBond` | Organizers stake QIE so sponsors can open a campaign to any bonded organizer. Sponsors challenge, the protocol Safe arbitrates and may slash. Arbitration is centralized in v1. | 6,618 B |
| `PresenceLens` | `IPresence` over the registry for other contracts and the SDK. Resolves a linked wallet to its pass. | 1,856 B |
| `QieIdCheck` | Says whether a wallet holds a QIE ID by reading QIE's name registry (`userDomain(wallet)` non-empty). Never reverts. | 550 B |
| `examples/PresenceGatedMint` | Reference integration: one souvenir NFT per person per attended event. | 5,848 B |
| `testnet/Testnet*` | Testnet stand-ins for QUSDC (public mint, 10,000 per call), QIE's name registry (public `claim(label)`) and the QIE/USD feed (owner posts prices). Never deployed on mainnet. | |

Interfaces live in `src/interfaces`. ABIs for the app, SDK and indexer are in `abi/` (regenerate with
`script/export-abi.sh`).

## How a check-in is proven

Mode 1 (rotating door QR). Every 15 seconds the door screen makes a throwaway ticket key, signs
`DoorPass(eventId, issuedAt, ticket)` with its authorized door key, and puts the ticket's private key in the QR.
The attendee's phone signs `CheckIn(eventId, attendee, 1)` with the pass key and `Ticket(eventId, attendee)` with
the scanned ticket key. On chain the transaction only ever shows signatures, never the ticket private key, so a door
pass read from a mined transaction cannot admit anyone else (audit C-01). Someone who sees the screen itself (or a
stream of it) can still admit passes until `issuedAt + maxPassAge`; that is the documented residual risk of mode 1.

Mode 2 (door scans you). The door signs `DoorAttest(eventId, attendee, attestedAt)` for one attendee whose phone
showed a code signed `CheckIn(eventId, attendee, 2)`. The ticket fields must be empty. The presence is dated by
`attestedAt`, so an offline-queued attendance is paid by when it happened (audit L-05).

Because `CheckIn` commits to the mode, a mode 2 code shown at the door cannot be replayed as a weaker mode 1
presence to lock the attendee out of mode 2 campaigns (audit M-01).

Batch status codes for `checkInBatch`: 0 Recorded, 1 AlreadyPresent, 2 UnknownEvent, 3 BadAttendeeSig,
4 BadDoorSig, 5 DoorKeyNotAuthorized, 6 Stale, 7 OutsideEventWindow, 8 AtCapacity, 9 BadMode, 10 Paused,
11 BadTicketSig. `checkIn` reverts with the error of the same name.

## How money moves

1. `createCampaign` escrows a deposit. Native QIE must match `msg.value`; ERC-20 deposits are credited by the
   balance delta, so a fee-on-transfer token cannot inflate a campaign.
2. A presence is recorded by the registry. Recording presence and paying for it are separate transactions, so a
   campaign problem can never block a check-in.
3. `settle` or `settleBatch` (permissionless, sent by the relayer right after a check-in) checks, in order: the
   campaign exists, the presence is not yet paid, the settlement window is open, a presence of the required proof
   mode exists inside the campaign window, the event is approved (or the organizer is bonded enough for an open
   campaign), caps, the QIE ID gate, the price, the organizer's remaining bonded exposure and the budget. A paid presence moves `gross` from the campaign
   balance into claimable balances: `fee = gross * feeBps / 10000`, `toAttendee = (gross - fee) * share / 10000`,
   the rest to the organizer. Nothing is transferred at this point.
4. `withdraw(token, account)` pays a claimable balance out. A linked pass is always paid to its wallet, so anyone
   (the relayer) may trigger it; an unlinked account must call it itself.
5. `refund` returns the unspent balance to the sponsor once `endsAt + SETTLE_GRACE` (3 days) has passed.

USD pricing: `amountPerPresence` is USD with 6 decimals and the feed has 8, so
`wei = Math.mulDiv(usd6, 1e20, answer)`. One dollar at a price of 16,500,000 ($0.165) pays 6.0606e18 wei. A round
that is older than `maxOracleAge`, non-positive, incomplete (`answeredInRound < roundId`), dated in the future,
unreadable, or that would round to zero defers the item with status 9 (`PriceStale`) instead of mispricing it.

Pause (owner, the Safe) stops new campaigns, top-ups and settlement on the vault, and new events, check-ins and
links on the registry. It never stops `refund` or `withdraw`.

## Trust assumptions

- **QIE ID gate.** Zone balance is not used. A wallet holds a QIE ID when QIE's name registry
  (`0x1D69d75AD7b77b91C3760F84faC52E651710f62e`) returns a non-empty `userDomain` for it. That registry is an
  upgradeable proxy (EIP-1967) whose owner is an externally owned account (`0x9a689036A798cF1a96e65c1911cE7B444C4e06a4`
  on 19 Nov 2026), so the gate inherits that trust: whoever controls the registry decides who counts as a QIE ID
  holder. A hostile upgrade could therefore wrongly admit or exclude wallets from QIE-ID-gated campaigns (paying
  within those campaigns' normal per-presence amounts and caps). It cannot do more: `QieIdCheck` calls it with a
  100,000 gas cap, copies at most 64 bytes back and treats any revert or malformed answer as "no QIE ID", so the
  registry can never revert or stall settlement, and ungated campaigns never consult it.
- **Price.** The QIE/USD feed (`0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17`) is trusted for UsdInNative campaigns.
  The default `maxOracleAge` is 48 hours because the measured p99 gap between rounds is 29.5 hours and the longest
  50 hours; a stale feed delays USD payouts and never misprices them.
- **Open-to-bonded campaigns.** A bond in QIE backs open campaigns paid in native QIE only (token or USD pricing);
  an ERC-20 campaign cannot be open to bonded organizers, because a QIE stake cannot bound a payout in a token the
  vault cannot price. The vault keeps `bondedExposure[organizer]`, the gross ever paid at that organizer's events
  through bonded eligibility across every campaign, and refuses a payout (status 5) that would take it above the
  organizer's current bond, so one stake backs at most its own value however many open campaigns exist
  (audit M-02). Payouts for explicitly approved events are not counted.
- **Arbitration.** The OrganizerBond owner (the protocol Safe) resolves challenges and may slash any bonded or
  pending stake to any recipient, at its discretion. Only a sponsor whose campaign has actually paid for presences at
  the organizer's events may challenge it, with at most one open challenge per (campaign, organizer) (audit L-03).
  An open challenge blocks the organizer's `completeUnbond` until the Safe resolves it.
- **Door key validity (audit L-01, accepted).** `validUntil` bounds the signed door time, not the submission time,
  so the mode 2 offline queue keeps working after a shift. A key whose `validUntil` has passed can still sign
  attestations dated inside its validity until `endsAt + 3 days`. To stop a key (a shift ended, a phone was lost),
  the organizer must call `revokeDoorKey`; the door console should do that when a shift ends.
- **Pause and the grace period (audit L-04, accepted).** Settlement deadlines keep running while the vault is paused.
  If a pause lasts past a campaign's `endsAt + SETTLE_GRACE`, its recorded but unsettled presences can no longer be
  paid and the sponsor refunds that money. The Safe must unpause before the grace period of any live campaign ends.
- **Feed denomination (audit I-01).** The mainnet feed reports `QIE / USDT`, so UsdInNative campaigns are priced in
  USDT and a USDT depeg misprices them.
- **QUSDC issuer (audit I-02).** QUSDC's `VAULT_ROLE` can `burn(from, amount)` from any address without an allowance,
  including the vault. A holder of that role could make the vault insolvent in QUSDC; this is an issuer trust
  assumption of every QUSDC campaign.
- **Proof modes.** Mode 1 (rotating door QR) checks freshness against block time but can be relayed by someone
  streaming the screen. Mode 2 (door scans you) binds the door's attestation to one attendee. Sponsors choose the
  weakest mode they pay for with `minProofMode`.
- **Owners.** Every Ownable2Step contract (registry, stamp, vault, bond) has its ownership handed to the protocol
  Safe after deploy, and `renounceOwnership` is disabled everywhere (audit L-06). Owners can pause, set the fee
  (capped at 5%, the bps applied to new campaigns only; a new fee recipient applies to all campaigns), set the stamp
  base URI and arbitrate. They cannot move escrowed or claimable funds.

## Invariants and the tests that prove them

All ten invariants of `docs/INTERFACES.md` 2.8 are checked by `test/invariant/Invariants.t.sol` after every call of a
random sequence driven by `test/invariant/ShowmarkHandler.sol` (256 runs of 128 calls). The handler keeps its own
model of the check-in rules, door-key authorizations, oracle freshness and payout maths, and raises a flag on any
disagreement with the contracts. Unit tests pin the same properties down case by case.

| # | Invariant | Invariant test | Unit tests |
|---|---|---|---|
| 1 | Presence recorded at most once per (event, attendee) | `invariant_1_presenceAtMostOnce` (also one stamp per presence) | `test_checkIn_rejectsDuplicate`, `test_checkInBatch_mixedStatuses` |
| 2 | No vault state can make `checkIn` revert | `invariant_2_checkInIndependentOfVault` | `IntegrationTest.test_checkInSucceedsWhateverTheVaultState` (vault paused, campaign out of budget, oracle stale and reverting, name registry down) |
| 3 | `balance >= totalLiabilities == sum(balances) + sum(claimables)` per token | `invariant_3_solvency` | `test_settle_*`, `test_createCampaign_feeOnTransferTokenCreditedByBalanceDelta` |
| 4 | Sponsor can always refund after `endsAt + SETTLE_GRACE`, even paused | `invariant_4_refundAlwaysAvailable` (snapshots, pauses and refunds every funded campaign at every step) | `test_refund_*` |
| 5 | Only an organizer-authorized door key, inside its validity, can attest | `invariant_5_onlyAuthorizedDoorKeys` | `test_checkIn_rejectsUnauthorizedDoorKey`, `...DoorKeyOfAnotherEvent`, `...DoorKeyPastValidity`, `test_revokeDoorKey_blocksCheckIn` |
| 6 | No signature replay across events, contracts or chains, no reuse of a harvested door pass for another attendee, no mode swap | `invariant_6_noReplay` | `test_checkIn_signaturesForOtherChainOrContractFail`, `test_checkIn_doorPassReplayedOnOtherEventFails`, `test_checkIn_doorPassCannotBeUsedAsAttestation`, `test_checkIn_mode1RequiresTicketSignedByTheDoorPassTicket`, `test_checkIn_attendeeSignatureBindsTheMode`, `test/audit/AuditPoC.t.sol` |
| 7 | Fee never exceeds `MAX_FEE_BPS` (500) | `invariant_7_feeCapped` | `test_setFee`, `testFuzz_splitConservesGross` |
| 8 | A malicious native receiver cannot drain or double-claim | `invariant_8_reentrancy` (the attacker is a sponsor and an organizer) | `ReentrancyTest` (withdraw, refund, cross-function), `test_completeUnbond_reentrancyPaysOnce` |
| 9 | No upgradeability; pause never blocks refund or withdraw | `invariant_9_immutableAndExitsNeverPaused` (code hashes constant; every claim withdrawn while paused) | `test_refund_worksWhilePausedAndForErc20`, `test_withdraw_worksWhilePausedAndForErc20` |
| 10 | Stale or non-positive price defers (status 9), never misprices | `invariant_10_oracleNeverMisprices` | `test_oracle_*`, `testFuzz_usdPricing` |

A full run checks every invariant against real traffic. Totals for one run of the suite after the audit fixes
(256 runs, 32,768 calls, no handler reverts even with fail-on-revert; from the `ACC` log line at `-vv`): 1,591
check-ins recorded and 3,045 rejected, 143 presences settled, 82 settlements deferred for price, 114 withdrawals,
194 refunds, and 97 withdrawals or refunds made while the vault was paused. Disabling the ticket check makes
invariant 6 fail, so the new replay cases are not vacuous.

## Differences from docs/INTERFACES.md

Each is the safest correct variant of a gap or flaw found while building, and is listed for the lead.

- **OpenZeppelin v5.1.0, not 5.6.x.** Releases 5.2 to 5.7 use the Cancun-only `mcopy` opcode in `Bytes.sol` (reached
  through `Strings`, `EIP712` and `SignatureChecker`) and from 5.5 in `Arrays.sol` (reached through `ERC1155`). They
  do not compile for `shanghai` and QIE rejects `MCOPY`. v5.1.0 is the newest release with no `mcopy`, `tstore` or
  `tload` in any file used.
- **QIE ID through `IQieIdCheck`** (lead's change). The vault constructor takes `qieIdCheck` where the spec had `zone`.
- **`IPresence.presenceKeyOf(account)` added.** A pass and its linked wallet both satisfy `hasAttended`, so a
  one-per-person gate keyed by `msg.sender` could be claimed twice. Integrators key claims by `presenceKeyOf`.
- **Streaks only advance forward.** The spec formula resets `current` to 1 when a lower series index is recorded
  after a higher one, which happens when a mode 2 offline queue lands late. Such a record now leaves the streak alone.
- **Links refuse chains.** Besides `walletOf[pass]` and `passOf[wallet]` being unset, a pass may not already be a
  wallet and a wallet may not already be a linked pass, keeping passes and wallets two disjoint sets.
- **Stamps follow the link.** After a pass links a wallet, new stamps mint to the wallet. Presence stays keyed by
  the pass. Because the relocation list given to `linkWallet` is not signed, `relocateStamps(pass, ids)` lets anyone
  move a linked pass's leftover stamps, and only ever to that pass's own wallet.
- **Withdraw for an unlinked account is self-only.** Otherwise anyone could push rewards onto a gasless pass key
  before its owner links a wallet. Linked passes (the relayer path) and organizers calling for themselves work as
  specified.
- **Pause also blocks `topUp`,** so no new money enters a paused vault. Refund and withdraw still always work.
- **`openToBonded` requires `minBond > 0` and native QIE.** With a zero minimum, "open to bonded organizers" would
  mean open to anyone. The native-only rule follows from the exposure cap: a QIE bond can only bound QIE payouts.
- **Audit fixes beyond the interface text.** The bonded exposure cap (M-02) adds the `bondedExposure` view, the
  challenge rule (L-03) adds `paidForOrganizer`, `hasOpenChallenge` and the `OrganizerNotPaid` and
  `DuplicateChallenge` errors, and the oracle is read with a gas-capped staticcall (`ORACLE_QUERY_GAS`, 100,000)
  that copies five words, so a malformed answer defers with status 9 instead of reverting a batch (L-02).
- **A USD quote that rounds to zero defers** with `PriceStale` instead of spending the presence's single settlement
  on a zero payout.
- **`topUp` after `endsAt` reverts** (`CampaignEnded`) and **`approveEvents` rejects ids that do not exist yet**
  (`UnknownEvent(id)`), so a sponsor cannot pre-approve an id somebody else will create.
- **Check order.** Settlement checks `SettlementClosed` right after the campaign and already-settled checks; check-in
  checks `AlreadyPresent` before signature recovery. The status codes and their meanings are unchanged.
- **OrganizerBond details.** The vault address is set once after deploy (`setVault`), because the vault is
  constructed with the bond. The arbitrator is the owner. An open challenge blocks `completeUnbond`. `resolve`
  reverts when the slash exceeds bonded plus pending funds instead of silently cutting it.
- **Stamp mint and relocate skip the ERC-1155 receiver hook.** The stamp is soulbound, so the check is pointless,
  and skipping it means a check-in never calls attendee code and a smart wallet without a receiver can still link.
- **Oracle decimals are read at construction** (must be at most 18) instead of assumed to be 8.
- **Additive views** for the app and the SDK: registry `domainSeparator`, `nextSeriesId`, `seriesOrganizer` and the
  type hashes; vault `qieIdCheck`, `campaignCount`, `settledPerEvent`; bond `pendingUnbond`, `challengeOf`,
  `openChallenges`, `nextChallengeId`, `arbitrator`; stamp `baseURI` with a `BaseURIChanged` event.

## Test

```bash
forge test                          # unit, fuzz (2,000 runs) and invariant tests
forge test -vv --mt invariant       # invariants with run totals
QIE_FORK_RPC=https://rpc1mainnet.qie.digital forge test --mt test_fork   # QieIdCheck against QIE mainnet
forge coverage --report summary --no-match-coverage "(test|script)/"
forge snapshot                      # writes .gas-snapshot
forge test --gas-report             # docs/gas-report.txt
slither .                           # docs/slither.md explains every result
script/e2e-anvil.sh                 # deploy and run a full flow on a local chain with id 1983
```

Coverage of `src/` from the unit and fuzz tests alone (`--no-match-path "test/invariant/*"`), every contract
including the testnet stand-ins:

| Lines | Statements | Branches | Functions |
|---|---|---|---|
| 100% (595/595) | 100% (749/749) | 100% (162/162) | 100% (114/114) |

Constructor revert tests deploy through an external self-call (`this.deployVault(...)`). In this forge version
`new X(...)` in a test compiles to a `deployCode` cheatcode, and a constructor that reverts as expected would end
the test at that line, silently skipping every later check.

Gas on the anvil run (`docs/anvil-e2e.txt`): mode 1 check-in with ticket 115,476, settle 217,253 (first payout,
cold storage), withdraw about 46,000, wallet link with one relocation 120,788, create event 82,021, create campaign
160,351.

## Deploy

Requires Foundry and `jq`. Set the environment, then run the script against the chain:

| Variable | Default | Meaning |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | required | Deployer key; it owns everything until the Safe accepts |
| `SAFE_ADDRESS` | unset on testnet, **required on mainnet** | Starts `transferOwnership(SAFE)` on the registry, stamp, bond and vault |
| `ORACLE_MAX_AGE` | `172800` | Seconds before a price round counts as stale |
| `FEE_BPS` | `0` | Protocol fee for new campaigns, at most 500 |
| `FEE_RECIPIENT` | deployer on testnet, **required on mainnet** | Fee recipient |
| `STAMP_BASE_URI` | empty | Stamp metadata base, for example `https://<app>/api/stamp/`; changeable later |

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url qie_testnet --broadcast   # chain 1983, deploys stand-ins first
forge script script/Deploy.s.sol:Deploy --rpc-url qie --broadcast           # chain 1990, real QIE addresses
```

On 1990 the script uses QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, QIE's name registry
`0x1D69d75AD7b77b91C3760F84faC52E651710f62e` and the QIE/USD feed `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17`.
On 1990 it also checks that the feed reports 8 decimals and QUSDC 6 before deploying anything.
Any other chain id is refused. The script writes `deployments/{chainId}.json` with every address, the deploy block
(a safe lower bound for the indexer) and the constructor inputs.

After deploy:

1. The Safe calls `acceptOwnership()` on the registry, the stamp, the bond and the vault.
2. On testnet, the team keeps the stand-in price fresh, at least once every `ORACLE_MAX_AGE`:
   `cast send <oracle> "setAnswer(int256)" 16500000 --rpc-url qie_testnet --private-key ...`. Testers get QUSDC
   with `mint(address,uint256)` and a QIE ID with `claim(string)` on the stand-in name registry.

## Verify

```bash
script/verify.sh 1983      # testnet.qie.digital, stand-ins included
script/verify.sh 1990      # mainnet.qie.digital
DRY_RUN=1 script/verify.sh 1983   # print the commands only
```

The script reads `deployments/{chainId}.json`, encodes each constructor from the recorded inputs and runs
`forge verify-contract --verifier blockscout --verifier-url https://{mainnet|testnet}.qie.digital/api/`.
