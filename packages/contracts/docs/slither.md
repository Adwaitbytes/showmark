# Slither results

Run from `packages/contracts` with `slither .` (Slither 0.11.6, 102 detectors). `slither.config.json` limits the
report to `src/` by filtering `lib/`, `test/` and `script/`.

Result on 19 Nov 2026, after the audit and both re-reviews' fixes: 30 results in 7 detectors. None is a defect, so no code change was needed. Each is listed
below with the reason it is accepted. Two lint-level items found earlier by `forge lint` were fixed in code: the
`CheckedIn` event is emitted before the stamp mint, and the `uint64(block.timestamp)` cast is annotated.

## uninitialized-local (3)

| Location | Justification |
|---|---|
| `ShowmarkRegistry.checkInBatch` `doorKey` | Deliberately zero when the batch is paused; only read when the status is `Recorded`, which `_validate` sets together with the key. |
| `ShowmarkRegistry._record` `streak` | Zero is the specified streak for an event without a series. |
| `ShowmarkRegistry.createEvent` `seriesIndex` | Zero is the specified index for an event without a series. |

## unused-return (1)

| Location | Justification |
|---|---|
| `ShowmarkRegistry._recover` ignores `errArg` from `ECDSA.tryRecover` | Only the error kind matters; any error maps to "no signer" and a rejected check-in. |

## calls-loop (11)

| Location | Justification |
|---|---|
| `CampaignVault.approveEvents` calls `registry.eventInfo` per id | Registry is an immutable Showmark contract; a view call that cannot revert for any id. |
| `CampaignVault._settle` calls `registry.presenceOf` / `registry.eventInfo` (2) | Same immutable registry; plain storage reads that cannot revert. |
| `CampaignVault._settle` calls `bond.bondOf` | Immutable Showmark bond; plain storage read. |
| `CampaignVault._holdsQieId` calls `registry.walletOf` | Immutable registry; plain storage read. |
| `CampaignVault._holdsQieId` calls `qieIdCheck.hasQieId` | Wrapped in try/catch; QieIdCheck itself never reverts and caps the registry call at 100k gas, so one item cannot stall a batch. |
| `PresenceLens.attendedCount` calls `registry.hasAttended` per id | View helper; the caller chooses the list length. |
| `ShowmarkRegistry._record` calls `stamp.mint` (2) | The stamp is deployed by the registry, has no receiver hook and cannot revert for a fresh presence. |
| `ShowmarkRegistry.linkWallet` calls `stamp.relocate` per id | Same stamp; ids the pass does not hold are skipped, so a stale list cannot block a link. |
| `ShowmarkRegistry.relocateStamps` calls `stamp.relocate` per id | Same stamp and the same skip rule; the caller pays for the list it chooses. |

## reentrancy-events (1)

| Location | Justification |
|---|---|
| `ShowmarkRegistry.checkInBatch` emits `CheckInRejected` after an earlier item's `stamp.mint` | The only external call is to the registry's own stamp, which never calls out (mint skips the ERC-1155 receiver hook), so no reentrant path exists to reorder logs. Within `_record` the `CheckedIn` event is emitted before the mint. |

## timestamp (10)

| Location | Justification |
|---|---|
| `CampaignVault.topUp`, `closeCampaign`, `refund`, `_settle`, `_quote` | Campaign windows, the 3 day grace period and the 48 hour oracle age are hours to days long; validator drift of a few seconds cannot change an outcome that matters. |
| `OrganizerBond.completeUnbond` | 7 day unbond delay; seconds of drift are irrelevant. |
| `CampaignVault.releaseExposure` | Releases a campaign's bonded exposure only after `endsAt + SETTLE_GRACE` (3 days); seconds of drift cannot let a still-payable campaign release early in any way that matters, because settlement uses the same bound. |
| `OrganizerBond._locked` | False positive: `claimed < stake` compares amounts only; Slither taints `stake` because it is read next to the pending unbond's `availableAt`. The same taint adds the `locked > bonded` and `pending <= held` amount comparisons to the `completeUnbond` entry. |
| `ShowmarkRegistry.linkWallet` | Signature deadline chosen by the signer, minutes long. |
| `ShowmarkRegistry._validate` | Check-in freshness and windows are the product's core rule and are defined against block time by the spec; a 30 second clock-skew allowance is built in, and the residual risk (a relayed rotating QR) is documented in the threat model. |

## assembly (2)

| Location | Justification |
|---|---|
| `CampaignVault._readOracle` | Deliberate (audit L-02): a gas-capped `staticcall` to the feed that copies exactly five words and checks their size and ranges, so a reverting, gas-burning or malformed feed defers USD items with status 9 instead of reverting `settleBatch`. Covered by `test_oracle_malformedAnswersDeferWithoutRevertingTheBatch` and the audit regression `test_L02_*`. |
| `QieIdCheck.hasQieId` | Deliberate: a gas-capped `staticcall` that copies at most 64 bytes of return data, so an upgraded or hostile name registry cannot revert settlement, burn the caller's gas or return-bomb it. Every malformed answer is covered by `test/QieIdCheck.t.sol`. |

## unindexed-event-address (2)

| Location | Justification |
|---|---|
| `ICampaignVault.FeeChanged(uint16,address)` | Signature is fixed by `docs/INTERFACES.md` and decoded by the indexer; it fires only on owner fee changes. |
| `IOrganizerBond.VaultSet(address)` | Emitted once at deploy; nobody filters on it. |
