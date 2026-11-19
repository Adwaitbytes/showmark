# Showmark contracts: independent security review

## Scope

- Repository commit `3b5bb35c785c26f73c38815bc87b71573dc31ad3`. The last commit touching `packages/contracts/src` is
  `51e030521064949aba47c2a5f0fd6d42b391183b`; no contract source changed during the review.
- `src/ShowmarkRegistry.sol`, `src/PresenceStamp.sol`, `src/CampaignVault.sol`, `src/OrganizerBond.sol`,
  `src/PresenceLens.sol`, `src/QieIdCheck.sol`, `src/interfaces/*`, `src/examples/PresenceGatedMint.sol`,
  `src/testnet/*` (testnet only), `script/Deploy.s.sol`, the test suite, and the 16 deviations listed in
  `packages/contracts/README.md`.
- Toolchain: solc 0.8.38, EVM shanghai, OpenZeppelin Contracts v5.1.0 (submodule at `69c8def`, clean), Foundry,
  Slither.
- The reviewer did not write the code.

## Method

1. Read `docs/INTERFACES.md` section 2, `docs/SECURITY.md`, `docs/ARCHITECTURE.md` and the contracts README, then
   every contract line by line against them.
2. Built attacker models for each role: remote stranger, attendee, griefer watching the mempool or the chain,
   dishonest organizer, dishonest sponsor, malicious ERC-20 or receiver, compromised or careless owner.
3. Checked the app code that produces the signatures (`apps/web/src/lib/qr/payload.ts`, campaign and event form
   defaults) to judge which attacks are reachable in practice.
4. Read the mainnet dependencies on chain (QIE RPC, chain id 1990) and the verified QUSDC source on the explorer.
5. Wrote a proof-of-concept test for every finding: `test/audit/AuditPoC.t.sol`. Each test passes while the issue
   exists. Run with `forge test --match-path "test/audit/*" -vv`.
6. Ran the full suite, coverage and Slither (results below).

### Tool results

- `forge test`: 170 passed, 0 failed, 1 skipped (the fork test, which needs `QIE_FORK_RPC`). Invariant run: 256
  runs x 128 calls, no handler reverts.
- `forge coverage --report summary --no-match-coverage "(test|script)/" --no-match-path "test/invariant/*"`: 100%
  lines (557/557), statements (697/697), branches (150/150) and functions (109/109) over `src/`.
- `slither .`: 29 results, all informational or low (uninitialized locals that default to zero, ignored tuple
  members of `latestRoundData` and `tryRecover`, external calls in loops over trusted contracts, timestamp
  comparisons, assembly in `QieIdCheck`, unindexed event addresses). None is a vulnerability.
- Audit PoCs: 10 passed.

## Summary

| ID | Severity | Title | PoC |
|---|---|---|---|
| C-01 | Critical | Mode 1 door passes are public on chain, so anyone anywhere can check in unlimited sybil passes and drain mode 1 campaigns or fill capacity | `test_C01_remoteSybilsDrainMode1CampaignWithHarvestedDoorPass`, `test_C01_harvestedDoorPassFillsCapacity` |
| M-01 | Medium | Proof-mode downgrade: a public attendee signature plus any door pass permanently locks the attendee out of mode 2 campaigns | `test_M01_modeDowngradeLocksAttendeeOutOfMode2Campaign` |
| M-02 | Medium | One organizer bond backs every open-to-bonded campaign at once; losses are unbounded relative to the slashable stake | `test_M02_singleBondDrainsSeveralOpenCampaigns` |
| L-01 | Low | A door key keeps attesting after `validUntil` by back-dating `attestedAt` | `test_L01_expiredDoorKeyBackdatesAttestations` |
| L-02 | Low | A malformed oracle answer reverts the whole `settleBatch` (try/catch does not catch decoding) | `test_L02_malformedOracleAnswerRevertsWholeSettleBatch` |
| L-03 | Low | Anyone can spam challenges against any organizer and freeze their unbond | `test_L03_challengeSpamLocksAnyOrganizersUnbond` |
| L-04 | Low | A pause that outlasts the settlement grace voids earned payouts | `test_L04_pauseThroughGraceVoidsEarnedPayouts` |
| L-05 | Low | Mode 2 presence is dated by submission block, not by `attestedAt`; offline-queued attendances miss the campaign | `test_L05_offlineQueuedAttestationDatedBySubmission` |
| L-06 | Low | `renounceOwnership` is live on every Ownable2Step contract; on the bond it locks challenged stakes forever | `test_L06_renounceOwnershipStrandsChallengedBond` |
| I-01 | Informational | Mainnet feed is `QIE / USDT`, not QIE/USD | on-chain read |
| I-02 | Informational | QUSDC `VAULT_ROLE` can `burn(from, amount)` from any address, including the vault | verified source |
| I-03 | Informational | Deploy script allows mainnet without `SAFE_ADDRESS` and defaults the fee recipient to the deployer | review |
| I-04 | Informational | Arbitrator power is broader than `SECURITY.md` states | review |
| I-05 | Informational | Attendee `CheckIn` signatures never expire and do not bind mode or door time | review |
| I-06 | Informational | Linking to a permissive ERC-1271 contract, and transferable QIE IDs, weaken the QIE ID gate | review |
| I-07 | Informational | Test-suite gaps: invariants 5 and 6 encode the issues above as allowed behaviour | review |

---

## Findings

### C-01 Critical: mode 1 door passes are public on chain, so anyone anywhere can check in unlimited sybil passes

**Location:** `src/ShowmarkRegistry.sol:324-342` (`_validate`, mode 1 branch); `DoorPass(eventId, issuedAt)` type.

**Description.** A mode 1 door signature is not bound to an attendee and is accepted for any number of attendees
until `issuedAt + maxPassAge` (30 to 600 s, app default 120 s). Every honest mode 1 check-in publishes the
`doorSig` and `doorTime` in the calldata of a `checkIn` or `checkInBatch` transaction. So during the whole event,
any observer of the chain always holds a valid door pass, without being at the venue and without an accomplice.
`docs/SECURITY.md` states the threat as "someone at the venue streaming the screen"; the real threat is a
fully remote, automated bot.

**Exploit scenario.** A sponsor creates a campaign with the app defaults (`minProofMode = 1`,
`requireQieId = false`, no `maxPerEvent`, no `maxTotal`) and approves an event. When the first attendee checks in,
the attacker reads the transaction, generates N fresh keys, signs `CheckIn(eventId, key)` with each, submits one
`checkInBatch` reusing the harvested `doorSig`, then `settleBatch` and `withdraw` from each key. The PoC drains 20
of 21 presences from a campaign and takes the full attendee share (10 QIE of 20). With a 0 percent attendee share
the attacker gains nothing directly but still burns the sponsor's budget, and the same move fills the event's
capacity so real attendees get `AtCapacity` at the door (second PoC). Mode 2 events are not affected.

**PoC:** `test_C01_remoteSybilsDrainMode1CampaignWithHarvestedDoorPass`, `test_C01_harvestedDoorPassFillsCapacity`.

**Recommended fix.** Treat mode 1 as unpayable unless further bound. In order of strength:

1. Pin each door pass to the block that first uses it, so a pass read from a mined transaction is dead. The relayer
   already batches; it submits every attendee who scanned the same 15 s code in one `checkInBatch`.

   ```solidity
   mapping(bytes32 doorPassDigest => uint256 firstBlock) private _doorPassBlock;

   // in _record, mode 1 only (and the same test in _validate, returning STALE):
   bytes32 h = keccak256(abi.encode(d.eventId, d.doorTime, doorKey));
   uint256 first = _doorPassBlock[h];
   if (first == 0) _doorPassBlock[h] = block.number;
   else if (first != block.number) revert Stale();
   ```

   Pair it with a per-pass use cap (for example 64 records per `(eventId, issuedAt, doorKey)`) to bound mempool
   piggybacking inside that block.
2. Change the app defaults to `minProofMode = 2`, or for mode 1 require `requireQieId` and a non-zero
   `maxPerEvent`, and say on the sponsor form that mode 1 can be farmed remotely.
3. Correct `docs/SECURITY.md` ("Proof of presence, honestly") to describe the remote attack.

---

### M-01 Medium: proof-mode downgrade locks an attendee out of mode 2 campaigns

**Location:** `src/ShowmarkRegistry.sol:317-326` (`CheckIn` covers only `eventId, attendee`; first presence wins);
`src/CampaignVault.sol:303`.

**Description.** The attendee's `CheckIn` signature does not commit to the proof mode. In mode 2 the attendee's
phone displays it in clear (`SM2.{eventId}.{attendee}.{attendeeSig}`, `apps/web/src/lib/qr/payload.ts`), and it is
also visible in the mempool. Anyone who reads it can combine it with a harvested mode 1 door pass (C-01) and record
a mode 1 presence first. Presence is write-once, so the door's real `DoorAttest` reverts with `AlreadyPresent` and
every `minProofMode = 2` campaign returns `NotPresent` for that attendee forever.

**Exploit scenario.** A griefer in the queue photographs attendees' codes (or a bot reads pending mode 2
transactions, or reads codes the offline door queue will submit later) and downgrades each one. The attendees lose
their mode 2 rewards and the organizer loses the organizer share for them. Cost: one transaction each.

**PoC:** `test_M01_modeDowngradeLocksAttendeeOutOfMode2Campaign`.

**Recommended fix.** Bind the mode into the attendee signature,
`CheckIn(uint256 eventId,address attendee,uint8 mode)`, and have the app sign mode 2 codes with `mode = 2`.
Alternatively allow a later, stronger record to upgrade the stored mode (without a second stamp or a second
`checkedIn` increment):

```solidity
Presence storage p = _presence[d.eventId][d.attendee];
if (p.mode != 0 && d.mode <= p.mode) return (ALREADY_PRESENT, address(0));
```

---

### M-02 Medium: one bond backs every open-to-bonded campaign at once

**Location:** `src/CampaignVault.sol:307`; `src/OrganizerBond.sol` (no per-campaign lock or exposure accounting).

**Description.** Eligibility is `bond.bondOf(organizer) >= c.minBond` at settlement time. Nothing reserves the
stake for a campaign or limits the total paid to an organizer against it. A bonded organizer controls its own door
keys, so it can record any number of mode 2 presences for passes it owns. The maximum recovery is a slash of the
one stake (`resolve` reverts above bonded plus pending), regardless of how many campaigns were drained.
`requestUnbond` also removes eligibility immediately, but only after the drain in the same block.

**Exploit scenario.** Two sponsors each fund an open campaign of 10 QIE with `minBond = 1 QIE`. A fresh organizer
bonds 1 QIE, creates an event, authorizes its own door key, checks in 10 self-made passes in mode 2, settles all of
them against both campaigns and requests unbond. It holds 20 QIE of claims (10 as organizer, 10 through its own
passes); the arbitrator can slash at most 1 QIE. The PoC shows `resolve(..., 2 ether, ...)` reverting with
`SlashExceedsBond`.

**PoC:** `test_M02_singleBondDrainsSeveralOpenCampaigns`.

**Recommended fix.** Make the bond carry exposure. For example, track `paidToOrganizer[campaignId][organizer]`
and stop eligibility at a multiple of the bond:

```solidity
uint256 b = bond.bondOf(organizer);
bool bonded = c.openToBonded && b >= c.minBond && openPaid[campaignId][organizer] + gross <= b;
// on success: openPaid[campaignId][organizer] += gross;
```

and/or have the bond lock `minBond` per campaign the organizer opts into. At the least, require `maxPerEvent` on
open campaigns and document in the sponsor UI that one bond is shared by every open campaign.

---

### L-01 Low: a door key keeps attesting after `validUntil` by back-dating

**Location:** `src/ShowmarkRegistry.sol:330-345`.

**Description.** Validity is checked against the signed `doorTime`, never against block time. A mode 2 key whose
`validUntil` has passed can still sign `DoorAttest` with `attestedAt <= validUntil` and have it recorded until
`endsAt + 3 days`. "Valid until" therefore means "can back-date to", not "stops working at". This matches the
literal spec text, but organizers will read `validUntil` as an expiry (a volunteer's shift, a lost phone).

**Exploit scenario.** An organizer gives a volunteer a key valid until 19:00. At 23:00, or two days later, the
volunteer signs attestations dated 18:59 for any number of passes. They are recorded as mode 2.

**PoC:** `test_L01_expiredDoorKeyBackdatesAttestations`.

**Recommended fix.** Also require `block.timestamp <= validUntil + CLOCK_SKEW` for mode 1, and for mode 2 either
the same, or store an authorization start and a separate `submitUntil` so that the offline queue keeps working
only for keys the organizer explicitly allowed to submit late. At minimum, document that a key must be revoked
(not left to expire) and have the door console revoke keys when a shift ends.

---

### L-02 Low: a malformed oracle answer reverts the whole `settleBatch`

**Location:** `src/CampaignVault.sol:355-367`.

**Description.** Solidity's `try` does not catch a failure to ABI-decode the callee's return data, nor a call to
an address without code when return data is expected. If the feed proxy at
`0x3Bc617cF...3D17` is upgraded or misconfigured to return short data, `_quote` reverts instead of returning
`PriceStale`, which reverts `settleBatch` for every item, including token-priced items that never read the feed,
and `quote()`. The README says an "unreadable" round defers with status 9.

**PoC:** `test_L02_malformedOracleAnswerRevertsWholeSettleBatch` (the same token-priced item settles on its own).

**Recommended fix.** Read the feed with a low-level `staticcall`, check `success && ret.length >= 160`, then
`abi.decode`. Optionally cap the gas forwarded, as `QieIdCheck` does.

---

### L-03 Low: anyone can freeze any organizer's unbond with challenge spam

**Location:** `src/OrganizerBond.sol:106-121`, `:80-90`.

**Description.** `challenge` only checks that the caller sponsors some campaign, and `createCampaign` accepts a
zero deposit. The challenged organizer need not have anything to do with that campaign. Each challenge increments
`openChallenges`, and `completeUnbond` requires zero, so a griefer can open hundreds of challenges for gas and
the Safe must execute one `resolve` per challenge before the organizer can exit.

**PoC:** `test_L03_challengeSpamLocksAnyOrganizersUnbond`.

**Recommended fix.** Require the organizer to be relevant to the campaign (it has at least one settlement paid
by that campaign, which the vault can expose as `paidOrganizer[campaignId][organizer]`), require a non-zero
challenge deposit that is returned or forfeited on resolve, and allow one open challenge per
`(campaignId, organizer)`. Add a batch `resolveMany` for the Safe.

---

### L-04 Low: a pause through the grace period voids earned payouts

**Location:** `src/CampaignVault.sol:219, 232-236, 300`.

**Description.** Pause blocks settlement but the settlement deadline `endsAt + SETTLE_GRACE` keeps running. If
the vault stays paused past it (an incident that takes more than three days to resolve, or a hostile owner),
every recorded but unsettled presence can never be paid and the sponsor refunds that money. `SECURITY.md` lists
pause as unable to hurt users because refund and withdraw keep working, but it can cancel money already earned.

**PoC:** `test_L04_pauseThroughGraceVoidsEarnedPayouts`.

**Recommended fix.** Track the cumulative paused duration and extend both deadlines by it, for example
`pausedTotal` updated in `pause`/`unpause` plus a per-campaign snapshot at creation, so
`deadline = endsAt + SETTLE_GRACE + (pausedTotalNow - pausedTotalAtCreation)`, applied identically in `_settle`
and `refund` so they stay mutually exclusive. If that is too heavy, document the power in the trust table.

---

### L-05 Low: mode 2 presence is dated by the submission block

**Location:** `src/ShowmarkRegistry.sol:354`; `src/CampaignVault.sol:304`.

**Description.** `Presence.at` is `block.timestamp` of the record, but the registry deliberately accepts mode 2
attestations up to `endsAt + 3 days` (offline queue). A door that comes back online after a campaign's `endsAt`
(or after a sponsor's `closeCampaign`) records presences that the campaign then refuses with
`OutsideCampaignWindow`, although the attendance happened inside the window. The reverse also holds: an
attestation made before a campaign's `startsAt` but submitted later is paid.

**PoC:** `test_L05_offlineQueuedAttestationDatedBySubmission`.

**Recommended fix.** Store the attested time for mode 2 (`at = doorTime`, which is already checked to be
`<= block.timestamp + 30` and inside the event window) or store both, and use the attested time in the vault's
window check. Keep `SETTLE_GRACE` at least as long as `LATE_SUBMISSION` so the queue can still be settled.

---

### L-06 Low: `renounceOwnership` is live

**Location:** `ShowmarkRegistry`, `PresenceStamp`, `CampaignVault`, `OrganizerBond` (inherited from OZ `Ownable`).

**Description.** The Safe can renounce ownership in one transaction. On the bond, every organizer with an open
challenge can then never `completeUnbond` and their stake is locked forever. On the registry or vault, a renounce
while paused leaves them paused forever (refund and withdraw still work; check-ins, links and settlement stop).

**PoC:** `test_L06_renounceOwnershipStrandsChallengedBond`.

**Recommended fix.**

```solidity
function renounceOwnership() public pure override {
    revert RenounceDisabled();
}
```

---

### I-01 Informational: the mainnet feed is `QIE / USDT`

`0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17` on chain 1990 reports `description() = "QIE / USDT"`,
`decimals() = 8` (read on 19 Nov 2026; latest answer 16,491,619, about 25 hours old, inside the 48 h limit).
UsdInNative campaigns are therefore priced in USDT, and a USDT depeg misprices them. Say so in the README and the
sponsor UI, or rename the pricing mode.

### I-02 Informational: QUSDC can be burned out of the vault by its issuer

The verified QUSDC source (`0x3F43...5DA5`, 6 decimals, not a proxy) has
`burn(address from, uint256 amount) external onlyRole(VAULT_ROLE)` with no allowance check. Any `VAULT_ROLE`
holder can burn the vault's QUSDC and make it insolvent for that token (last withdrawers and refunds fail). This
is an issuer trust assumption that the README's trust section does not mention; add it.

### I-03 Informational: deploy script on mainnet

The addresses for chain 1990 match the expected QUSDC, oracle and name registry, constructor arguments are wired
correctly, `setVault` is called before the handover, and every Ownable2Step contract gets `transferOwnership(SAFE)`.
However, on 1990 the script proceeds with `SAFE_ADDRESS` unset (deployer EOA keeps every power) and defaults
`FEE_RECIPIENT` to the deployer. Make both mandatory when `block.chainid == 1990`, and assert
`oracle.decimals() == 8` and the QUSDC `decimals() == 6` before broadcasting.

### I-04 Informational: arbitrator power

The bond owner can create a zero-deposit campaign, challenge any bonded organizer and `resolve` with the whole
bonded plus pending stake to any recipient. The slash is not bounded by any damage to the challenging campaign.
`SECURITY.md` says "Can slash only bonded organizer stake", which is accurate but understates that the Safe has
full discretionary custody of every bond. The fee recipient set by `setFee` also applies to existing campaigns
(only `feeBps` is snapshotted); that is fine but worth a line in the trust table.

### I-05 Informational: attendee signatures never expire

`CheckIn(eventId, attendee)` has no deadline, mode or door-time binding. It is a reusable bearer credential for that
event until a presence is recorded. This is what enables M-01 and is harmless otherwise.

### I-06 Informational: QIE ID gate strength

`linkWallet` accepts any ERC-1271 contract whose `isValidSignature` is permissive, so a pass can be linked to a
third-party contract that holds a QIE ID. The gate is also evaluated at settlement time, so if QIE names are
transferable one name can qualify several wallets in turn. Both are within the "free QIE IDs are a weak filter"
statement in `SECURITY.md`.

### I-07 Informational: test-suite observations

The ten invariants are real, not vacuous: the handler keeps an independent model, records about 1,500 check-ins
and 150 settlements per run, exercises pause, oracle failure modes and a reentrant receiver, and the invariant
test snapshots and refunds every campaign at every step. Gaps:

- Invariant 5 models door C as authorized for back-dated `doorTime` after its validity (L-01 is encoded as correct).
- Invariant 6 replays only full check-ins; it never reuses a door pass for a different attendee (C-01) or swaps
  modes with the same attendee signature (M-01).
- No handler path has an organizer other than the fixed one settle against open-to-bonded campaigns (M-02).
- No ERC-20 with hooks or fee-on-transfer in the invariant run (unit tests cover fee-on-transfer).

---

## Deviations from INTERFACES.md (README list of 16)

| Deviation | Verdict |
|---|---|
| OpenZeppelin v5.1.0 | Safe. Clean `v5.1.0` tag; no published advisory affects 5.1.0 in the modules used. |
| QIE ID through `IQieIdCheck` | Safe. Gas-capped staticcall, 64-byte copy, malformed answers read as false. See I-06. |
| `IPresence.presenceKeyOf` added | Safe and necessary; `PresenceGatedMint` uses it correctly. |
| Streaks only advance forward | Safe. Late mode 2 records cannot reset a newer streak. |
| Links refuse chains | Safe. Passes and wallets stay disjoint. |
| Stamps follow the link; permissionless `relocateStamps` | Safe. Moves only to the pass's own linked wallet. |
| Withdraw for an unlinked account is self-only | Safe and an improvement. |
| Pause also blocks `topUp` | Safe. |
| `openToBonded` requires `minBond > 0` | Safe and necessary, but not sufficient (M-02). |
| USD quote rounding to zero defers | Safe. |
| `topUp` after `endsAt` reverts; `approveEvents` rejects unknown ids | Safe. Pre-approval squatting is prevented. |
| Check order changes | Safe. Status codes unchanged; `SettlementClosed` before reads does not change outcomes. |
| OrganizerBond details (`setVault` once, owner arbitrates, challenge blocks unbond, slash reverts above stake) | Safe in isolation; see L-03, L-06, I-04. |
| Stamp mint and relocate skip the receiver hook | Safe. Removes the only attendee-code callback from check-in. |
| Oracle decimals read at construction | Safe. Bounded at 18; overflow impossible (`uint128 * 1e30` fits). |
| Additive views | Safe. |

## Checked and found sound

- **Solvency and accounting.** Every path keeps `_liabilities[token] == sum(balances) + sum(claimables)`: funding
  adds the measured balance delta, settlement moves `gross` from balance to claimables with
  `fee + toAttendee + toOrganizer == gross` exactly (round-down on fee and attendee share, remainder to organizer),
  withdraw and refund subtract before paying. Per-token accounting isolates a malicious ERC-20 to its own token.
  Forced native transfers only over-collateralize.
- **Reentrancy.** All value-moving vault functions share one `nonReentrant` guard and update state before
  `sendValue`/`safeTransfer`. Unguarded vault functions (`approveEvents`, `revokeEvents`, `closeCampaign`) cannot
  move funds. Registry check-in and linking make no call to attendee code (hookless stamp). Bond `completeUnbond`
  and `resolve` delete before paying.
- **Double payment.** `_settled[campaign][event][attendee]` is set inside `_credit`; duplicates inside one batch
  return `AlreadySettled`.
- **Refund versus settlement.** `settle` needs `now <= endsAt + 3 days`, `refund` needs `now > endsAt + 3 days`;
  `closeCampaign` only lowers `endsAt` and presences at or before the new end stay payable during grace; `topUp`
  after `endsAt` is refused, so nothing can be added to a refunded campaign.
- **Caps.** `maxPerEvent` and `maxTotal` are checked before crediting and incremented in the same step.
- **Oracle.** Non-positive, zero `updatedAt`, future, stale, incomplete rounds and zero quotes defer with status 9;
  reverts are caught (only malformed data is not, L-02). USD maths cannot overflow.
- **Signatures.** EIP-712 domain with cached chain id rebuilt on fork; distinct type hashes for the four structs so
  `DoorPass` cannot pass as `DoorAttest`; `ECDSA.tryRecover` rejects high-s and bad lengths; door keys are per event
  and revocation deletes them; `LinkWallet` requires both parties and is one-shot, so its signatures cannot be
  replayed; the unsigned relocation list cannot move stamps anywhere but the pass's own wallet.
- **Check-in liveness.** The registry never reads the vault, the oracle or the name registry; `checkInBatch` never
  reverts per item; all time arithmetic is in `uint256`.
- **Withdraw routing.** A linked pass always pays its wallet; an unlinked account can only withdraw for itself.
- **Access control.** Ownable2Step everywhere; `setVault` is owner-only and one-shot; fee capped at 500 bps and
  snapshotted per campaign; owners cannot move escrow or claims (subject to L-04 and L-06).
- **QieIdCheck.** Return-data handling is correct for empty, short, oversized and non-string answers.
- **PresenceGatedMint.** Claims keyed by `presenceKeyOf`; a pass and its wallet cannot claim twice.

## Verdict

Not ready for mainnet with sponsor funds while mode 1 campaigns can be created. C-01 lets anyone drain any mode 1
campaign remotely during a live event, and the app's default campaign is mode 1 with no QIE ID gate and no caps.
The escrow mechanics themselves (accounting, reentrancy, refunds, pause, fees) are sound. Fix C-01 (or ship with
mode 1 campaigns disabled or forced to QIE ID plus per-event caps), M-01 and M-02 before launch; L-01 to L-06 are
cheap and should go in the same release, since the contracts are immutable.
