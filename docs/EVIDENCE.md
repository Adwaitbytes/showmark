# Evidence

Proof for every claim we make, newest at the bottom of each section. Explorer links open the transaction on QIE's Blockscout.

## Contracts

### Testnet (chain 1983), audited code after all fixes through re-review N-01 and N-02

Deployed 19 Nov 2026 from deployer `0xA8C849C243BA940102d2deB99971e4c713411926`, deploy block 9859857. Every contract is source-verified on https://testnet.qie.digital.

| Contract | Address |
|---|---|
| ShowmarkRegistry | [0xd03B9d6691296761216b02053f00d77FD0f2802A](https://testnet.qie.digital/address/0xd03B9d6691296761216b02053f00d77FD0f2802A) |
| PresenceStamp | [0xAceE5A7EdA63af6952429c97a693ca690024559E](https://testnet.qie.digital/address/0xAceE5A7EdA63af6952429c97a693ca690024559E) |
| CampaignVault | [0xFAA5c9159F5dfB4b9fbB104E10c7280a1fe6FCDe](https://testnet.qie.digital/address/0xFAA5c9159F5dfB4b9fbB104E10c7280a1fe6FCDe) |
| OrganizerBond | [0xd9737Ca433D58496d46d947138e97c28E19fA722](https://testnet.qie.digital/address/0xd9737Ca433D58496d46d947138e97c28E19fA722) |
| PresenceLens | [0x28dB120c102c743d6846254E90bA9ef85f3b2145](https://testnet.qie.digital/address/0x28dB120c102c743d6846254E90bA9ef85f3b2145) |
| QieIdCheck | [0x5BC38FC820dee09FE8Cb2E573ebA31769987F5a3](https://testnet.qie.digital/address/0x5BC38FC820dee09FE8Cb2E573ebA31769987F5a3) |
| Testnet QUSDC, name registry, price feed | stand-ins listed in `packages/contracts/deployments/1983.json` |

Note: the testnet explorer only recognised PresenceStamp (created inside the registry constructor) after a direct transaction to it ([setBaseURI](https://testnet.qie.digital/tx/0x70ba8fad18a9616311bddbb054efb3dbc534e97b3be607c8d76610980c150e71)); the mainnet explorer already recognises factory-created contracts.

### Mainnet (chain 1990)

Pending: needs mainnet QIE and the protocol Safe (see NEEDS_FROM_YATHU.md).

## Tests

| Suite | Result | Run |
|---|---|---|
| Foundry (unit, fuzz, invariant, audit regressions) | 218 passed, 0 failed, 1 skipped (opt-in mainnet fork) | 19 Nov, workstream A, rerun by lead |
| Foundry invariants | 256 runs x 128 calls, 0 handler reverts, also under fail-on-revert | 19 Nov |
| Coverage of `packages/contracts/src` | 100% lines, statements, branches, functions | 19 Nov |
| Web (vitest) | 228 passed, 9 skipped (opt-in live network tests) | 19 Nov, lead |
| Web against anvil (relayer, indexer, queries) | 6 of 6 | 19 Nov, lead |
| SDK | 85 passed | 19 Nov |
| MCP | 15 passed | 19 Nov |

Independent security review: `packages/contracts/docs/AUDIT.md` (three rounds).

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
