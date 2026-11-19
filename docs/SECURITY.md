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

- **Rotating door QR (mode 1).** Freshness is enforced on-chain against block time, so a screenshot from yesterday is useless. It does not stop someone at the venue from streaming the screen to a friend outside within the pass window. That is why sponsors can require mode 2.
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

The contracts are audited by a separate agent that did not write them, against the invariants and threat model above. Findings and their resolutions are listed here before mainnet deployment.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| | | Review pending | |
