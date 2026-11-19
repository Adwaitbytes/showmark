# Evidence

Proof for every claim we make, newest at the bottom of each section. Explorer links open the transaction on QIE's Blockscout.

## Contracts

### Testnet (chain 1983), final audited code (fourth re-review: go)

Deployed 19 Nov 2026 from deployer `0xA8C849C243BA940102d2deB99971e4c713411926`, deploy block 9860279. Source-verified on https://testnet.qie.digital (PresenceStamp verification is retried after the explorer indexes it; see note).

| Contract | Address |
|---|---|
| ShowmarkRegistry | [0xb97517a6Ab3E097a894949793Cf478c7C2485032](https://testnet.qie.digital/address/0xb97517a6Ab3E097a894949793Cf478c7C2485032) |
| PresenceStamp | [0x5104d466fbeFcA6062672C8Fd61AA45c48635818](https://testnet.qie.digital/address/0x5104d466fbeFcA6062672C8Fd61AA45c48635818) |
| CampaignVault | [0xb772A3786AD2b65eB648cE2eEf205Dc4F4Dc18b1](https://testnet.qie.digital/address/0xb772A3786AD2b65eB648cE2eEf205Dc4F4Dc18b1) |
| OrganizerBond | [0xC741Fd300f72b340BeE933b9BD09F68E589f56f5](https://testnet.qie.digital/address/0xC741Fd300f72b340BeE933b9BD09F68E589f56f5) |
| PresenceLens | [0x496c7D21B1Ec6A303e822Ca486D602Cb352D8050](https://testnet.qie.digital/address/0x496c7D21B1Ec6A303e822Ca486D602Cb352D8050) |
| QieIdCheck | [0xAb19A9469e4ed5f1F4531FB1D378f509CE17aB7a](https://testnet.qie.digital/address/0xAb19A9469e4ed5f1F4531FB1D378f509CE17aB7a) |

Note: the testnet explorer does not index contracts created inside another constructor until a transaction touches them directly, so PresenceStamp gets a `setBaseURI` poke before verification. The mainnet explorer recognises such contracts already. Earlier testnet deployments from the same day (pre-audit-fix) are superseded and no longer used by the app.

### Mainnet (chain 1990)

Pending: needs mainnet QIE and the protocol Safe (see NEEDS_FROM_YATHU.md).

## Tests

| Suite | Result | Run |
|---|---|---|
| Foundry (unit, fuzz, invariant, audit regressions) | 238 passed, 0 failed, 1 skipped (opt-in mainnet fork) | 19 Nov, rerun by lead on the final code |
| Foundry invariants | 256 runs x 128 calls, 0 handler reverts, also under fail-on-revert | 19 Nov |
| Coverage of `packages/contracts/src` | 100% lines, statements, branches, functions | 19 Nov |
| Web (vitest) | 228 passed, 9 skipped (opt-in live network tests) | 19 Nov, lead |
| Web against anvil (relayer, indexer, queries) | 6 of 6 | 19 Nov, lead |
| SDK | 85 passed | 19 Nov |
| MCP | 15 passed | 19 Nov |

Independent security review: `packages/contracts/docs/AUDIT.md` (four rounds, final verdict go for mainnet).

## Journeys on the production URL against the real chain

### 1. Attendee check-in, mode 1, testnet (19 Nov 2026, 16:13 IST)

- Event 1 "Showmark testnet walkthrough" created by the organizer: [0x07c1252e…8b10](https://testnet.qie.digital/tx/0x07c1252ed3261337e9dde031a9c319625c4001dc7e2c4dc05a15c98d4cc28b10)
- Door key authorized: [0x6691c7ef…b6fa](https://testnet.qie.digital/tx/0x6691c7efac097779a81ccca44977a2cc9de137e70719db1ea04ce0fe9f76b6fa)
- Sponsor campaign 1 funded with 0.2 QIE, 0.01 QIE per presence, 60 percent to the attendee: [0xd82284b4…161f](https://testnet.qie.digital/tx/0xd82284b41c878521f8bf6d95953a0976ec136fba4d1ca0f6bfb8c00fc58a161f)
- Event approved into the campaign: [0xdbf5cad4…cad5](https://testnet.qie.digital/tx/0xdbf5cad4c00b77b836e0ebff24791425df02f655760f703ae7b200996e78cad5)
- A freshly signed door code was opened on https://showmark.vercel.app in Chrome with no wallet. The app created a pass, signed, and the relayer submitted it. The page showed "You are checked in" with the stamp within about 8 seconds of opening.
- Presence recorded on chain: [CheckedIn 0x18bb7928…2b81](https://testnet.qie.digital/tx/0x18bb7928e05da0f450f9e271888f26be3928b6ec1848710396e24adb2ab92b81), attendee pass `0x7135b35892cec6640a693bbbf71b831ddf67f4e9`
- Escrow settled for that presence in a separate transaction: [Settled 0x8e0e48f1…f8f1](https://testnet.qie.digital/tx/0x8e0e48f18db6c34bed159714b6fda4d6198e1b305c08a55b4bf37199aa38f8f1)
- The ticket key fragment was removed from the address bar after load.

### 2. Attendee check-in on the final audited contracts (19 Nov 2026, 16:38 IST)

- Event 1 created [0x217f375a…9cea](https://testnet.qie.digital/tx/0x217f375a81ab781d996375b03e6dc1a51e938863169b69d42c89e424291e9cea), door key authorized [0x7d36e6ab…7737](https://testnet.qie.digital/tx/0x7d36e6ab467d5a9af873756e9bae5cd045238006e2f9bde27ebf21b67d4a7737), campaign 1 funded with 0.2 QIE [0xa87c2ec8…695a](https://testnet.qie.digital/tx/0xa87c2ec8ea3af1658fce64bb1ac0d7035f3afd66ec5a32ab4db2d5b22991695a), event approved [0xf55a7afe…70ac](https://testnet.qie.digital/tx/0xf55a7afe297b36b0a6025ff4f9914104703e8aee54150c61aced7c36888d70ac).
- Measured in Chrome on https://showmark.vercel.app: 7.4 seconds from navigation start to "You are checked in" (presence confirmed on chain). Desktop on broadband; the mid-range Android measurement on mobile data is still to be done at a real event.
- Presence: [CheckedIn 0x3c5e8c6b…9369](https://testnet.qie.digital/tx/0x3c5e8c6b3087eea69b124d86df676eb0bb35385527e7438f9821453c759a9369). Payout: [Settled 0xe061ed0d…7e48](https://testnet.qie.digital/tx/0xe061ed0d897d7f1b0da1f2833766c589545216f2955f648b7eb2686d2d787e48).
- "Open my passport" showed the stamp and 0.006 QIE claimable immediately (the stuck-passport bug from journey 1 is fixed by commit b754c91).

### 3. Judges' desk, testnet (19 Nov 2026, 16:59 IST)

- Event 2 "Judges' desk" runs until 13 Dec 2026 with a team-funded pool (campaign 2, [0x2709956e…e611](https://testnet.qie.digital/tx/0x2709956ece3a24d265f5200d0be69be878e34ed988f61fa57353d37be594e611), approved [0xebf25708…d5e4](https://testnet.qie.digital/tx/0xebf25708e57db1d013c6820c7948a525a3a656e3184c0fb1b966183f5ba5d5e4)). Its door key lives only on the server.
- https://showmark.vercel.app/judges showed a rotating code, the live count and the team-funded note. `/api/judges-desk/pass` returned a fresh pass with `Cache-Control: no-store` and the ticket key only in the URL fragment.
- Opening the desk's code as a judge's phone would: 8.9 seconds from taking the code to "You are checked in", measured in Chrome.
- Presence: [CheckedIn 0xbca9f4db…a11e](https://testnet.qie.digital/tx/0xbca9f4db83fad1706c5ddbf582cb31f6f8f65303b7a8a587bc0685f913bfa11e). Payout: [Settled 0x1190b66a…7ebb](https://testnet.qie.digital/tx/0x1190b66a7db4ca81b611a430608732624190affe4b52f98a428b92998d7c7ebb).
