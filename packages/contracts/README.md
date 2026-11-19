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
| `ShowmarkRegistry` | Events, series, door keys, check-ins (single and batched), streaks and pass-to-wallet links. Verifies the attendee's `CheckIn` and the door's `DoorPass` or `DoorAttest` EIP-712 signatures (domain `Showmark`, version `1`). Never calls the vault. Deploys the stamp in its constructor. | 14,799 B |
| `PresenceStamp` | Soulbound ERC-1155, token id = event id. Only the registry mints and relocates; transfers and approvals revert with `Soulbound()`. `uri(id)` is `{baseURI}{id}`. | 6,290 B |
| `CampaignVault` | Sponsor escrow. Pays per verified presence in a token amount or in USD converted to QIE at the oracle price, splits fee, attendee and organizer shares into claimable balances, and refunds the rest after the grace period. | 16,931 B |
| `OrganizerBond` | Organizers stake QIE so sponsors can open a campaign to any bonded organizer. Sponsors challenge, the protocol Safe arbitrates and may slash. Arbitration is centralized in v1. | 5,980 B |
| `PresenceLens` | `IPresence` over the registry for other contracts and the SDK. Resolves a linked wallet to its pass. | 1,856 B |
| `QieIdCheck` | Says whether a wallet holds a QIE ID by reading QIE's name registry (`userDomain(wallet)` non-empty). Never reverts. | 550 B |
| `examples/PresenceGatedMint` | Reference integration: one souvenir NFT per person per attended event. | 5,848 B |
| `testnet/Testnet*` | Testnet stand-ins for QUSDC (public mint, 10,000 per call), QIE's name registry (public `claim(label)`) and the QIE/USD feed (owner posts prices). Never deployed on mainnet. | |

Interfaces live in `src/interfaces`. ABIs for the app, SDK and indexer are in `abi/` (regenerate with
`script/export-abi.sh`).

## How money moves

1. `createCampaign` escrows a deposit. Native QIE must match `msg.value`; ERC-20 deposits are credited by the
   balance delta, so a fee-on-transfer token cannot inflate a campaign.
2. A presence is recorded by the registry. Recording presence and paying for it are separate transactions, so a
   campaign problem can never block a check-in.
3. `settle` or `settleBatch` (permissionless, sent by the relayer right after a check-in) checks, in order: the
   campaign exists, the presence is not yet paid, the settlement window is open, a presence of the required proof
   mode exists inside the campaign window, the event is approved (or the organizer is bonded enough for an open
   campaign), caps, the QIE ID gate, the price and the budget. A paid presence moves `gross` from the campaign
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
- **Arbitration.** The OrganizerBond owner (the protocol Safe) resolves challenges and may slash. An open challenge
  blocks the organizer's `completeUnbond`, so a frivolous challenge delays an exit until the Safe dismisses it.
- **Proof modes.** Mode 1 (rotating door QR) checks freshness against block time but can be relayed by someone
  streaming the screen. Mode 2 (door scans you) binds the door's attestation to one attendee. Sponsors choose the
  weakest mode they pay for with `minProofMode`.
- **Owners.** Every Ownable2Step contract (registry, stamp, vault, bond) has its ownership handed to the protocol
  Safe after deploy. Owners can pause, set the fee (capped at 5%, applied to new campaigns only), set the stamp base
  URI and arbitrate. They cannot move escrowed or claimable funds.

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
| 6 | No signature replay across events, contracts or chains | `invariant_6_noReplay` | `test_checkIn_signaturesForOtherChainOrContractFail`, `test_checkIn_doorPassReplayedOnOtherEventFails`, `test_checkIn_doorPassCannotBeUsedAsAttestation` |
| 7 | Fee never exceeds `MAX_FEE_BPS` (500) | `invariant_7_feeCapped` | `test_setFee`, `testFuzz_splitConservesGross` |
| 8 | A malicious native receiver cannot drain or double-claim | `invariant_8_reentrancy` (the attacker is a sponsor and an organizer) | `ReentrancyTest` (withdraw, refund, cross-function), `test_completeUnbond_reentrancyPaysOnce` |
| 9 | No upgradeability; pause never blocks refund or withdraw | `invariant_9_immutableAndExitsNeverPaused` (code hashes constant; every claim withdrawn while paused) | `test_refund_worksWhilePausedAndForErc20`, `test_withdraw_worksWhilePausedAndForErc20` |
| 10 | Stale or non-positive price defers (status 9), never misprices | `invariant_10_oracleNeverMisprices` | `test_oracle_*`, `testFuzz_usdPricing` |

A full run checks every invariant against real traffic. Totals for one run of the suite on 19 Nov 2026 (256 runs,
32,768 calls, no handler reverts; from the `ACC` log line at `-vv`): 1,525 check-ins recorded and 3,130 rejected,
157 presences settled, 154 settlements deferred for price, 132 withdrawals, 202 refunds, and 79 withdrawals or
refunds made while the vault was paused.

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
- **`openToBonded` requires `minBond > 0`.** With a zero minimum, "open to bonded organizers" would mean open to
  anyone, and a self-made event with self-made passes could drain the campaign.
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
| 100% (557/557) | 100% (697/697) | 100% (150/150) | 100% (109/109) |

Constructor revert tests deploy through an external self-call (`this.deployVault(...)`). In this forge version
`new X(...)` in a test compiles to a `deployCode` cheatcode, and a constructor that reverts as expected would end
the test at that line, silently skipping every later check.

Gas on the anvil run (`docs/anvil-e2e.txt`): check-in 107,792, settle 194,882 (first payout, cold storage),
withdraw about 46,000, wallet link with one relocation 120,834, create event 82,044, create campaign 160,326.

## Deploy

Requires Foundry and `jq`. Set the environment, then run the script against the chain:

| Variable | Default | Meaning |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | required | Deployer key; it owns everything until the Safe accepts |
| `SAFE_ADDRESS` | unset | Starts `transferOwnership(SAFE)` on the registry, stamp, bond and vault |
| `ORACLE_MAX_AGE` | `172800` | Seconds before a price round counts as stale |
| `FEE_BPS` | `0` | Protocol fee for new campaigns, at most 500 |
| `FEE_RECIPIENT` | deployer | Fee recipient |
| `STAMP_BASE_URI` | empty | Stamp metadata base, for example `https://<app>/api/stamp/`; changeable later |

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url qie_testnet --broadcast   # chain 1983, deploys stand-ins first
forge script script/Deploy.s.sol:Deploy --rpc-url qie --broadcast           # chain 1990, real QIE addresses
```

On 1990 the script uses QUSDC `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, QIE's name registry
`0x1D69d75AD7b77b91C3760F84faC52E651710f62e` and the QIE/USD feed `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17`.
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
