# Security

This page states plainly what Showmark protects against, what it does not, and how the code enforces it. The independent review results and their resolutions are recorded at the bottom.

## Assets and who could want them

| Asset | Attacker | Goal |
|---|---|---|
| Sponsor escrow | Anyone, a dishonest organizer, a dishonest attendee | Drain it, or collect payouts without real presence |
| Attendee and organizer balances | Anyone | Redirect or double-claim them |
| Presence records and stamps | Farmers | Fake attendance to collect rewards or inflate reach |
| Relayer gas tank | Anyone on the internet | Burn the relayer's QIE with junk transactions |
| Protocol controls | A compromised team member | Pause forever, change fees, steal |

## Contract invariants

Each one has a Foundry test, listed in `packages/contracts/README.md`.

1. Presence is recorded at most once per event and attendee.
2. A check-in never reverts because of a campaign or payout problem. The registry has no dependency on the vault.
3. For every token, the vault's balance is at least the sum of campaign balances plus everything owed to people.
4. A sponsor can always recover unspent funds after the campaign ends plus three days, even when the protocol is paused.
5. Only a door key authorized by the event's organizer, inside its validity window, can attest.
6. Every signature is EIP-712 with chain id and verifying contract. Nothing replays across events, contracts or chains.
7. The protocol fee has a hard-coded cap of 5 percent and is fixed per campaign at creation.
8. State changes happen before external calls, everyone is paid by pull, and everything that moves funds is guarded against reentrancy.
9. No upgradeability. Pause stops new campaigns, check-ins and settlement, and never blocks refunds or withdrawals.
10. A stale or non-positive oracle price defers settlement and never misprices it.

## Proof of presence, honestly

- **Rotating door QR (mode 1).** Every 15 second rotation the door authorizes a throwaway ticket key whose private key exists only inside the QR (in the URL fragment, so it never reaches a server). A check-in needs that key's signature over the attendee's own address, and freshness is enforced on chain against block time. Reading the chain therefore never lets anyone admit themselves (this was audit finding C-01 before the fix). What mode 1 cannot stop is someone who can see the code, in the room or through a photo or live stream of the screen, sharing it within the pass window. That is why sponsors can require mode 2.
- **Door scans you (mode 2).** The door key signs an attestation bound to one attendee's address after staff scan that attendee's code. Someone outside the room cannot obtain one without the door staff scanning them.
- **Soft signals**, such as device limits, rate limits per IP and per pass, and anomaly flags in the sponsor report, are labelled as soft everywhere. They help, but they are not proof.
- **Sybil resistance.** Free QIE IDs make holding a name a weak filter on its own. The main defense is presence itself (each pass needs a door signature at a real place and time, and capacity is capped per event), backed by the organizer's bond and the sponsor's choice of which events and organizers to fund. Wallet links are one-to-one so one QIE ID cannot farm gated campaigns through many passes.
- **Self-dealing organizers.** An organizer controls the door, so a dishonest organizer could check in passes they control. Sponsors approve events explicitly or require a bond; the bond can be slashed by the arbitrator after a sponsor challenge. Arbitration is centralized in v1 (the protocol Safe), and we say so.

## Off-chain risks

- **Relayer.** Relays only to the registry and the vault, simulates every call before sending, rate-limits per IP and per pass, and alerts when the gas tank is low. A failed simulation costs nothing.
- **Pass keys** live in the browser's localStorage. A pass never holds funds: balances stay in the vault and can only be withdrawn to the linked wallet (or to the pass itself if never linked). Losing a pass loses the ability to sign new check-ins, not past stamps.
- **Sessions** for organizers and sponsors use a wallet signature, an httpOnly cookie signed with HMAC-SHA256, a 15 minute sliding window and a 12 hour cap.
- **Secrets** live only in environment variables. The repo runs gitleaks over every commit before each push.

## Trust and centralization

| Power | Holder | Limit |
|---|---|---|
| Pause registry and vault | Protocol Safe | Cannot block refunds or withdrawals |
| Set protocol fee and recipient | Protocol Safe | Hard cap 5 percent, new campaigns only |
| Stamp metadata base URL | Protocol Safe | Cosmetic only |
| Resolve bond challenges | Protocol Safe | Can slash only bonded organizer stake |
| Relayer key | Showmark server | Can only submit calls that also pass on-chain checks; holds gas money only |

## Independent review

The contracts were reviewed by a separate agent that did not write them, in four rounds, against the invariants and threat model above. The full report, with an exploit test for every finding, is `packages/contracts/docs/AUDIT.md`; every exploit is kept as a regression test that now asserts the attack fails.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C-01 | Critical | A mode 1 door signature in public calldata could admit unlimited remote passes | Fixed with per-rotation ticket keys |
| M-01 | Medium | The attendee signature did not bind the proof mode, so a shown mode 2 code could be downgraded | Fixed: `CheckIn` binds `mode` |
| M-02 | Medium | One bond qualified for many open campaigns at once | Fixed: cumulative bonded exposure capped by the bond, open campaigns in QIE only |
| N-01 | Medium | Anyone could burn an organizer's bond room with their own open campaign | Fixed: organizers opt in to each open campaign; exposure released after a clean grace period |
| N2-01 | Medium | A sock-puppet challenge could shield stake from an honest one | Fixed: challenges are claims sized by the campaign's bonded exposure |
| L-01 | Low | An expired door key could backdate mode 2 attestations | Documented: revoke a door key to stop it |
| L-02 | Low | A malformed oracle answer reverted a whole settlement batch | Fixed: gas-capped staticcall with size checks, defers instead |
| L-03, N-02, N2-02 | Low | Challenge spam could block an organizer's unbond | Fixed: deposit per challenge, claims only from bond-backed campaigns |
| L-04 | Low | A pause that outlasts the grace period voids unsettled payouts | Documented: the Safe must unpause before grace ends |
| L-05 | Low | Offline mode 2 attendance was dated by submission | Fixed: dated by the attestation |
| L-06 | Low | `renounceOwnership` could strand challenged bonds | Fixed: disabled on every contract |
| N3-01, N3-02 | Low | Claim snapshot timing and the release race at grace end | Being fixed: live claim refresh and a 7 day review period |
| N-03 | Info | Ticket key in the URL path reached server logs | Fixed: moved to the URL fragment |
| I-01 | Info | The mainnet price feed is QIE/USDT, not QIE/USD | Documented; "USD" amounts are USDT |
| I-02 | Info | QUSDC's issuer role can burn QUSDC held by any address, including the vault | Documented trust assumption for QUSDC campaigns |
| I-03 | Info | Mainnet deploy could proceed without a Safe | Fixed: the deploy script refuses |

Third re-review verdict: go for mainnet; no open finding lets anyone steal or lock escrow, claimable balances or bonded stake.
