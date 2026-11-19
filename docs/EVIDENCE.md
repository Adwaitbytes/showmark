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

## Wallet journeys on testnet (19 Nov 2026, 17:30 to 18:16 IST)

Run on https://showmark.vercel.app against QIE testnet (chain 1983) with the Playwright harness in `apps/web/e2e/live/`. The harness injects an EIP-1193 provider that announces itself over EIP-6963 as `me.qiewallet` ("QIE Wallet (test harness)") and forwards every request to a Node-side viem account holding the throwaway key `0xb1440BC29DF52587cCB946cb433F4474cE92D2d1`. It refuses any chain but 1983 (chain switch, typed-data domain, SIWE `Chain ID`, transaction `chainId`, and the RPC's own chain id before each send). Attendees run in fresh wallet-less 390x844 contexts. Screenshots (JPEG 70) and the raw run logs (`run-phone.json`, `run-desktop.json`: every wallet transaction, relayed hash, timing, console error, failed or slow request) are in `docs/qa/live/`.

Run it: `pnpm --filter web exec playwright test -c e2e/live/playwright.config.ts` (it spends testnet QIE). `LIVE_RESUME_PHONE` / `LIVE_RESUME_DESKTOP` (`eventId:campaignId:name`) reuse an event and campaign from an earlier run so a late failure does not lock another deposit; the final runs below used them.

| Journey | 390x844 | 1440x900 |
|---|---|---|
| 1. Organizer: SIWE sign-in, create event, door key, QR decodes | Pass | Pass |
| 2. Wallet-less attendee checks in, door count increments | Pass | Pass (inside 3) |
| 3. Sponsor: sign-in, fund native campaign, approve event, check-in settles, report | Pass | Pass |
| 4. Link QIE Wallet and withdraw to it | Pass, with bug B2 | not repeated |
| 5. Organizer withdraws their share at /organize | **Fail, bug B1** | **Fail, bug B1** |

### 1. Organizer (both viewports)

- Sign-in signs the server's message (`personal_sign`, chain 1983) and lands on "Your events".
- Phone event 6 "Harness night 11-19 12:11" (now to +2 days, capacity 50, created from `/organize/new`): [createEvent 0xd6c65cf5…bf2c](https://testnet.qie.digital/tx/0xd6c65cf57ec9f3cb82008a1ead7cb3610c538ca2f90235f5f34298141e0dbf2c), door key [authorizeDoorKey 0xb1b4cbff…e83f](https://testnet.qie.digital/tx/0xb1b4cbff97bff1fd88dd87bf41bb997fc1c216e830d13d104274754e335ee83f). Final phone run's door device: [authorizeDoorKey 0x7a0b015e…c3e8](https://testnet.qie.digital/tx/0x7a0b015ee2539fffe19ceac6d859131998ef018515e0554b067fa3834ff8c3e8).
- Desktop event 8 "Harness desk 11-19 12:29": [createEvent 0x176683e8…afae](https://testnet.qie.digital/tx/0x176683e8a5f74d53abbe0c6f31dc9527d9e991ec205629c440fc3b22c3e5afae), door key [authorizeDoorKey 0x67233a6b…0dda](https://testnet.qie.digital/tx/0x67233a6b321a0e639824a2634eed0feb4f845efc8986c34312af5fb545590dda). Final desktop run's door device: [authorizeDoorKey 0x86741398…f1b6](https://testnet.qie.digital/tx/0x86741398d276268acf1e87f1811e25a66bb15a7c37519b2ea8f9f211b282f1b6).
- Each time the rotating QR was rasterized and decoded with jsQR to `https://showmark.vercel.app/c/<eventId>.<issuedAt>.<sig>#<ticket key>`.
- "Authorize this device" click to first QR on screen: 2.3 to 7.4 s (8 runs).

### 2 and 3. Attendee check-in, sponsor campaign, settlement

- Phone campaign 5 (0.05 QIE, 0.01 QIE per presence, proof mode 1, no QIE ID, created from `/sponsor/new`): [createCampaign 0x64ef310a…f167](https://testnet.qie.digital/tx/0x64ef310aa259446b6912d96bf2094f7aac979c380b33a229310130f67863f167), event 6 approved on `/sponsor/5` [approveEvents 0x1c271b70…bda6](https://testnet.qie.digital/tx/0x1c271b70e3b385097f7e183786dfcbd56166bb0c347f655d7919c4157ad6bda6), topped up 0.02 QIE from the page in the final run [topUp 0x1ee6d168…d9da](https://testnet.qie.digital/tx/0x1ee6d1683244de1cc1cf0a761fdabed27e497cedb4f30f75bbb7e303304cd9da).
- Desktop campaign 6 (same terms): [createCampaign 0xd4ab1c6d…c899](https://testnet.qie.digital/tx/0xd4ab1c6da97e56eae50536ea393adb75e25ca6084bbb4f64330d1206de44c899), event 8 approved [approveEvents 0x14ad8c80…4b5b](https://testnet.qie.digital/tx/0x14ad8c80fd724288e89bfcfe197195db3c0ddbbd930c032c2638c098ce5f4b5b).
- Final phone run: attendee A [checkInBatch 0x8df4d811…35ce](https://testnet.qie.digital/tx/0x8df4d811e7d1f7a1cc766516d1472a6e189cedad2992a6c382c214c294f235ce); attendee B [checkInBatch 0x19086da7…29d3](https://testnet.qie.digital/tx/0x19086da7c91140d798d131f9610af24e59e3125ecb1720f60b8551212e9b29d3) settled in the same block [Settled 0x69899767…0265](https://testnet.qie.digital/tx/0x69899767e5b4c58a4209b85ea86c422d8eae9c832e82295a561c9a3ef0ff0265) (0.005 QIE to the attendee, 0.005 to the organizer), shown on `/sponsor/5` with an explorer link 3.0 s after the stamp.
- Final desktop run: [checkInBatch 0xdfd9b05d…226a](https://testnet.qie.digital/tx/0xdfd9b05d6dfb3c7a1537c93e234cd0d29e7b773b7da732375bae3f192dbb226a) settled [Settled 0x7526c952…67ac](https://testnet.qie.digital/tx/0x7526c9529f88d4f4117a4eddfb47e1269a8354db7682eb32fe0c8d37e34467ac) for attendee `0xf1e711F4a0535505A1cE7f4DD0768c2570B8Cb86`; the harness only accepts a payout link whose receipt settles that exact attendee. Listed 15.3 s after the stamp. Earlier desktop runs: [checkInBatch 0xae6d88d6…7d21](https://testnet.qie.digital/tx/0xae6d88d61683148e05387763ce0111c528535362c05a4d9e90029df44ca07d21) / [Settled 0x466bd440…9e74](https://testnet.qie.digital/tx/0x466bd440ce280b0531bc3e166f0babd50966920fa080ba796e43ff2a46b79e74), [checkInBatch 0x3b40c022…29ca](https://testnet.qie.digital/tx/0x3b40c02214726347b40754956742505d9a291500506d3b04c51c4d4580cf29ca) / [Settled 0x7cd17f46…d217](https://testnet.qie.digital/tx/0x7cd17f465726e23875dd5977a8c92edd2ac7906e9dce236ba0a519d272c9d217).
- Earlier phone runs on the same event and campaign: [checkInBatch 0x6b584cd9…e98a](https://testnet.qie.digital/tx/0x6b584cd9e64e7f0db37cdb3240595f56ae86c52d4d9046243a83bf15578fe98a), [checkInBatch 0xd2dd5701…fa06](https://testnet.qie.digital/tx/0xd2dd5701b9d562052f7a597c6a38e0307dc47b0b2f5914c6464b6e1e154afa06) / [Settled 0x5e935f86…4700](https://testnet.qie.digital/tx/0x5e935f86bda7c3f7c3142c7ad10838777b6b77cb9b184178f35da83e45524700), [checkInBatch 0x013c9863…57d5](https://testnet.qie.digital/tx/0x013c986335fc79a79c20fa9562a7769a4be0d377250b31b260a612256b9157d5), [checkInBatch 0xa17253b6…86f6](https://testnet.qie.digital/tx/0xa17253b64c9d7ec9d8a38b00671d28143314ca821e24dfe6cefdb251869786f6) / [Settled 0xa72b8c01…6265](https://testnet.qie.digital/tx/0xa72b8c0167ba40109d50e251c262658a6a6d73c6bb171222cfcc0cc6a86f6265). A check-in made before its event was approved was paid later by the retry cron: [Settled 0x6a7837d3…1fe5](https://testnet.qie.digital/tx/0x6a7837d34f992bca197528fb60bf168d3b9ab4365d661cb57bec1b7156391fe5).
- The door count rose by one within 0 to 3 s of the attendee seeing the stamp, every time. The ticket fragment was gone from the address bar after load. `/sponsor/5/report` and `/sponsor/6/report` rendered with explorer links.
- Door link opened to "You are checked in" (fresh context, cold pass, headless Chromium on broadband): 11.4, 11.9, 12.0, 12.8, 12.9, 13.2, 13.6, 15.0, 15.5 s, plus two outliers of 41.4 and 90.5 s. Breakdown from the network trace: the page posts the signed check-in 3 to 8 s after navigation, `/api/relay/check-in` answers in about 4 to 4.6 s, then `/api/tx` polling sees it mined 1 to 4 s later. In the 90.5 s outlier the POST left the page only at 84 s; nothing failed, so the time went before signing (page and chunk loading). The same session saw production requests stall for 18 to 29 s (`/sponsor`, `/api/events/8`, RSC prefetches) and one `/sponsor/5` that never reached `load` in 30 s. This is slower than the 7.4 s in journey 2 above and worth a look before real events.

### 4. Link and withdraw (390x844)

- The test wallet was linked through `/pass/link` (pass signature plus wallet `eth_signTypedData_v4`, relayed): [linkWallet 0x22c04930…f787](https://testnet.qie.digital/tx/0x22c04930fb79f000d4ffa6556b1c647cbbfd2c5d3f96687c0f41975b718af787), pass `0x743931b70DDBBCbe061c5AfD105Be463B1ea6B84`, 5.4 s from click to "QIE Wallet is linked". `/pass/withdraw` then kept saying "Link QIE Wallet before you withdraw." (bug B2) and that harness context ended, so its 0.005 QIE was withdrawn through the same endpoint the page calls (`POST /api/relay/withdraw`): [withdraw 0x97b60fdf…45dd](https://testnet.qie.digital/tx/0x97b60fdfcf234d84fb039b03b09ffb6aaaeeee9fc5698e7ff34f0f9cf16945dd). `cast balance` of the test wallet: 0.149999999992271972 to 0.154999999992271972 QIE, exactly +0.005.
- Links are one-to-one and permanent, so the full UI pass was repeated with a fresh gasless wallet `0x18b5c14CE02Ae13e08bf98F095F63580b112F741` injected the same way: link [linkWallet 0x3fd3b1f0…6195](https://testnet.qie.digital/tx/0x3fd3b1f07008e28acf0970e2635e5efdf4d66a3f941a1863dc07c6044a876195) in 4.9 s, `/pass/withdraw` recognised the link after 4 reloads (14.8 s), "Withdraw QIE" to "Withdrawn to your wallet" in 6.4 s: [withdraw 0x2e372451…bfb8](https://testnet.qie.digital/tx/0x2e372451b746c1bb95205ef8f8430139310d275db7139a6dbbdb9c603ee1bfb8). Balance 0 to 0.005 QIE.

### 5. Organizer withdraw: fails

`/organize` offers "Withdraw" next to 0.045 QIE (at the end of the session) and shows "The network rejected this withdrawal." See bug B1. The 0.045 QIE is still claimable by the test wallet, left in place so the bug can be reproduced.

### Bugs

**B1. Organizer withdraw on /organize always fails (high).** Repro: sign in at `/organize` with an organizer that has a claimable payout (test wallet `0xb144…D2d1`, 0.045 QIE), click "Withdraw". The page POSTs `/api/relay/withdraw` with `{"token":"0x0000000000000000000000000000000000000000","account":"0xb1440BC29DF52587cCB946cb433F4474cE92D2d1"}`, which returns 422 `{"error":{"code":"withdraw_rejected","message":"The network rejected this withdrawal."}}`; console: "Failed to load resource: the server responded with a status of 422". Cause: `CampaignVault.withdraw` lets anyone trigger a withdrawal only for an account with a linked wallet; an organizer is a plain wallet (`walletOf` is zero), so it requires `msg.sender == account`, and the relayer reverts with `WithdrawNotAllowed()` (`0x15e34e05`; `cast call` from the relayer `0xAaca…3660` reverts, from the organizer it succeeds). `Payouts` in `apps/web/src/app/(organizer)/_components/OrganizerHome.tsx` always uses the relay. Fix: send `vault.withdraw(token, organizer)` from the connected wallet (the organizer pays a tiny fee), or relay only when `walletOf(account)` is set. Screenshot `j5-desktop-02-withdraw-rejected.jpg`.

**B2. /pass/withdraw does not see a link that just landed (medium).** Repro: link a wallet at `/pass/link`, wait for "QIE Wallet is linked", open `/pass/withdraw` right away. It shows "Link QIE Wallet before you withdraw." and does not re-check; it reads the link once from the index, which lags the chain. It took 4 reloads (about 15 s) in the final run, and the first time the harness waited 45 s on one load without the page changing. Screenshot `j4-phone-04a-withdraw-says-link-first.jpg`. Fix: poll the passport while it says "not linked" (or read `walletOf` from the chain), or carry the fresh link through from the link page.

**B3. Slow first check-ins and stalled requests (medium, intermittent).** See timings above: 2 of 11 check-ins took 41 and 91 s, and several production requests stalled 18 to 29 s.

**Harness note, not an app bug.** viem 2.58 prepares local-account transactions with `eth_fillTransaction`, and QIE testnet answers it with intrinsic gas only (21,624 for `approveEvents`), so the first harness runs sent approvals that ran out of gas: [approveEvents 0x6aaa211e…4ff4](https://testnet.qie.digital/tx/0x6aaa211ecbc1abc7cb74429d4efbe2187b7e36d117da1716a5798cb5d1944ff4), [approveEvents 0x74b5bb47…1661](https://testnet.qie.digital/tx/0x74b5bb47a66f5bbe1a3d063305f868431571904d94c044a609110dc081771661), [approveEvents 0xa11dc672…c8bb](https://testnet.qie.digital/tx/0xa11dc6725f022ecebe81a631b36beeafb155505b2cfe7669f384d7491877c8bb) (gas used = limit = 21,624; `eth_estimateGas` gives 58,502). The app showed "The transaction was mined but the vault rejected it." correctly. The harness now estimates with `eth_estimateGas` plus 20 percent. The relayer already estimates by address and is not affected, but any future server code that sends from a local viem account without an explicit `gas` would hit this.

**Also seen.** The door screen headline briefly said "Event 8" instead of the event name while `/api/events/8` was stalled (29 s). On the door setup screen, the "Connect" button turns into "Authorize this device" in place once the wallet restores itself, so a tap at that moment authorizes the device (the wallet still asks to confirm).

### Spend

Test wallet 0.300 to 0.085 QIE. Locked: campaigns 3 and 4 (0.05 QIE each, from runs that stopped at the approval bug, never approved, refundable after they end), campaign 6 holds 0.02 QIE, and 0.045 QIE is claimable by the organizer (blocked by B1). Earlier aborted runs also created events 3, 4, 5 and 7 ([0x70a7a7c1…c4b5](https://testnet.qie.digital/tx/0x70a7a7c1be43d55b24b84cd8dbbb88e91d83455ea13238684ad84d944a39c4b5), [0xc26d8cad…1741](https://testnet.qie.digital/tx/0xc26d8cad69c39d4521139cee1de844d7f3923046c4387d80d7bad18863441741), [0x9bcbf6e0…84cf](https://testnet.qie.digital/tx/0x9bcbf6e01db83edcbbdd1892d3643cd7b6632f6454aab4eabe6c3fa19e3d84cf), [0x87c8ec5f…d583](https://testnet.qie.digital/tx/0x87c8ec5f246b5bfcbe12be03f984efc8f777b35464b8d878fde44280a5f5d583)) and campaigns 3 and 4 ([0x26d3139c…daa1](https://testnet.qie.digital/tx/0x26d3139c8836e1987961f029ade3ebec82ca31231caea6ed30bfbd2500d6daa1), [0x87a02499…7204](https://testnet.qie.digital/tx/0x87a0249963c7cbb84fc24c3b1cf86110945d0d94bee1789ec7c0acf661a77204)).

### 5. Check-in latency after moving functions to Mumbai (19 Nov 2026, 19:00 IST)

- Functions now run in bom1 (`x-vercel-id: bom1::bom1`), next to the Bengaluru QIE RPC and Mumbai Redis (D-044).
- Fresh pass in a clean Playwright browser on https://showmark.vercel.app: 8.5 s from navigation to "You are checked in". The check-in POST left at 1.5 s, the relay answered in 2.3 s, and the transaction was confirmed at about 8.2 s.
- The first request after the deploy hung in the browser for 15 s although the server broadcast the check-in in 2.5 s; the page recovered by retrying and showed the stamp. A chain-side presence check on the phone is being added so a lost response cannot cost more than a second or two.
