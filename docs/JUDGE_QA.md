# Judge Q&A

The 40 hardest questions we expect in demo week, with the answer we give and where the proof lives. First draft, 19 Nov 2026, written from the interfaces before the contracts are deployed. Before the drill, each owner opens every pointer in their section and fixes any answer that no longer matches the code.

How to use this:

- Answer in your own words. These are the facts to hit, not lines to recite.
- Lead with the honest limit when there is one. Judges trust a team that names its own weak spots.
- If you do not know, say so and say where you would look. Never guess a number.
- Contract and server paths follow the layout in `docs/INTERFACES.md` section 0. `[[FILL: confirm every pointer below resolves to a real file and function after Gate 3]]`

## Contracts

**1. Walk me through exactly what happens on-chain when someone checks in.**
The relayer calls `checkInBatch` on `ShowmarkRegistry` with two signatures per item: the attendee's pass key over `CheckIn(eventId, attendee)` and the door key over `DoorPass(eventId, issuedAt)` or `DoorAttest(eventId, attendee, attestedAt)`. The registry verifies both against its EIP-712 domain, checks that the door key was authorized by that event's organizer and is still valid, checks freshness against `block.timestamp`, the event window and capacity, then records presence once, updates the streak and mints a soulbound stamp whose token id is the event id. Each item returns a status code instead of reverting, so one bad check-in never sinks the batch.
Proof: `packages/contracts/src/ShowmarkRegistry.sol` (`checkInBatch`), `docs/INTERFACES.md` 2.3, `docs/ARCHITECTURE.md` "Check-in, step by step".

**2. Why are check-in and payment two transactions? One would be cheaper.**
So that no money problem can ever stop a person being checked in, which is invariant 2. The registry never calls the vault, so a paused vault, an empty budget or a stale oracle can delay a payout but never a presence. The cost is a second transaction, which the relayer sends straight after the first with the next nonce, so both usually land in the same block of about 3.6 seconds.
Proof: `docs/DECISIONS.md` D-004, invariant test 2 in `packages/contracts/test/invariant/`.

**3. What stops the same person being paid twice?**
Presence is recorded at most once per event and attendee (invariant 1), and the vault marks each campaign, event and attendee as settled before crediting anything, so a repeat returns `AlreadySettled`. Pass-to-wallet links are one-to-one in both directions, so one wallet cannot collect a QIE-ID-gated campaign again through a second pass. One human with several passes is a sybil question, answered in 14 to 16.
Proof: `CampaignVault.settle` and `isSettled` in `packages/contracts/src/CampaignVault.sol`, invariant test 1.

**4. How do you know the vault is solvent?**
For every token the vault tracks `totalLiabilities`, the sum of campaign balances plus everything owed to people, and an invariant test asserts that the contract's balance never drops below it across random sequences of deposits, settlements, refunds and withdrawals. Deposits are credited by the actual balance change rather than the requested amount, so a fee-on-transfer token cannot over-credit a campaign, and a mock fee-on-transfer token tests exactly that. Payouts are credited as claimable balances and only leave through `withdraw`.
Proof: `CampaignVault.totalLiabilities`, `packages/contracts/test/invariant/`, `packages/contracts/test/mocks/FeeOnTransferToken.sol`.

**5. Can your team take the sponsors' money?**
No. The contracts are immutable with no proxy, and the owner (a Safe on safe.qie.digital) can only pause new activity, set the fee within a hard 5 percent cap for new campaigns, change the stamp metadata URL and resolve bond challenges by slashing bonded organizer stake. None of those touch campaign balances, and refund and withdraw keep working while paused. The relayer key can only submit calls that pass the same on-chain checks as anyone else's.
Proof: `docs/SECURITY.md` "Trust and centralization", invariants 4, 7 and 9. Safe address: `[[FILL: protocol Safe address with explorer link]]`.

**6. How does dollar pricing work, and what happens when the oracle goes stale?**
A campaign can price each presence in USD and pay it in native QIE at the oracle price at settlement time. The vault reads `latestRoundData`, and if the answer is not positive or is older than `maxOracleAge`, settlement returns `PriceStale` and is retried later instead of paying a wrong amount (invariant 10). The QIE feed updates on deviation and we measured a gap of about 23 hours, so a USD-priced campaign can wait most of a day for a fresh price, which is why sponsors who want instant payouts price in tokens instead. The age limit is a constructor argument chosen from that measured history.
Proof: `docs/DECISIONS.md` D-003, `CampaignVault.quote`, chain facts in `CLAUDE.md`. Deployed limit: `[[FILL: maxOracleAge in seconds]]`.

**7. Why no upgradeability? What if you find a bug after launch?**
Sponsors trust us with escrow, and an upgradeable proxy would let whoever holds the admin key change the rules under them. If we find a bug, the Safe pauses new campaigns and check-ins, we deploy a fixed version, and existing sponsors still refund and attendees still withdraw from the old contracts, because those paths cannot be paused. The trade-off is that a fix means a migration rather than a patch, and we accept that.
Proof: invariant 9, `docs/ARCHITECTURE.md` "Contracts".

## Security

**8. Could a valid signature be replayed on another event, contract or chain?**
Every signature is EIP-712 with the domain name "Showmark", version 1, the chain id and the registry as the verifying contract, so it is useless anywhere else. The event id is inside every struct, door passes expire against block time, door attestations must fall inside the event window, and wallet links carry a deadline. Replaying a check-in on the same event is rejected because presence already exists.
Proof: `apps/web/src/lib/chain/eip712.ts`, `docs/INTERFACES.md` 2.2, invariant 6.

**9. What happens if your relayer key leaks?**
The relayer key holds gas money only, has no owner powers and cannot forge the attendee or door signatures that every check-in needs. A thief could spend the gas tank on calls the contracts reject, or relay real signed check-ins that we would have relayed anyway. We would rotate the key in the environment and move what is left; nothing on-chain trusts the relayer's address.
Proof: `docs/SECURITY.md` "Off-chain risks", `apps/web/src/server/relayer/`.

**10. Can someone burn your relayer's gas with junk requests?**
The relayer only sends to the registry and the vault, simulates every call with `eth_call` first and drops anything that would fail, so junk costs nothing. It limits check-ins to 10 a minute per IP and 3 a minute per pass in Upstash, and logs a warning when the tank drops below 5 QIE. At 1 gwei a contract call costs around 0.0001 to 0.0002 QIE, so even abuse that gets through burns very little.
Proof: `docs/INTERFACES.md` section 3 relayer rules, `apps/web/src/server/relayer/`.

**11. How do you handle reentrancy on native QIE payouts?**
Everyone is paid by pull: settlement only credits balances, and `withdraw` zeroes the balance before sending, behind a reentrancy guard. We use the storage-based guard because QIE Mainnet rejects `TSTORE` as an invalid opcode, so the transient-storage guard would break the contract, and we compile for shanghai for the same reason. An invariant test pays a malicious receiver that tries to re-enter and checks it cannot drain or double-claim.
Proof: `docs/DECISIONS.md` D-002, invariant 8, `packages/contracts/foundry.toml`.

**12. What if an attendee loses their phone or clears their browser?**
A pass never holds funds: rewards sit in the vault and, once the pass is linked, can only be withdrawn to the linked wallet, and linking moves the stamps to the wallet. So losing a linked pass only loses the ability to sign new check-ins with it. An unlinked guest who clears their browser does lose that pass and whatever it earned, which is why the app asks guests to link QIE Wallet after their first stamp, and wallet-first users can recreate their pass on a new phone from a wallet signature.
Proof: `apps/web/src/lib/wallet/pass.ts` (`derivePassKey`), `docs/DECISIONS.md` D-006 and D-009. `[[FILL: confirm the app prompts guests to link after the first stamp]]`

**13. Who audited your contracts?**
Not a paid audit firm, and we will not pretend otherwise. The contracts have unit tests on every branch that moves funds or records presence, fuzz and invariant tests for all ten invariants, static analysis with `[[FILL: Slither or the tool used]]`, and an independent review by a separate agent that did not write them and tried to break them against our threat model. Its `[[FILL: number of findings]]` findings and the resolution of each are in the table at the bottom of SECURITY.md.
Proof: `docs/SECURITY.md` "Independent review", `packages/contracts/README.md`, coverage report `[[FILL: link]]`.

## Sybil resistance

**14. What stops one person making fifty passes and checking in fifty times?**
Every check-in needs a door signature at a real place inside the event window, and each event has a capacity cap, so passes alone get you nothing. In mode 1, one person at the door with several phones or browser profiles could check in several passes, and the per-IP and per-pass rate limits only slow that down. In mode 2 staff scan each attendee's code, so fifty passes means fifty scans in front of a person, and sponsors can also cap payouts per event and in total.
Proof: `docs/SECURITY.md` "Proof of presence, honestly", `maxPerEvent` and `maxTotal` in `docs/INTERFACES.md` 2.5.

**15. A QIE ID is free. Isn't that a useless sybil filter?**
On its own it is weak, and our docs say so. It adds a small cost per identity and ties the payout to a named wallet, and because pass-to-wallet links are one-to-one, one QIE ID cannot collect a gated campaign through many passes. The real defense is presence itself, the organizer's bond and the sponsor choosing which events and organizers to fund. If QIE's partner API exposes KYC status or trust scores, a verified tier fits into the same gate.
Proof: `docs/SECURITY.md` "Sybil resistance", `docs/DECISIONS.md` D-006 and D-007.

**16. The organizer controls the door. What stops them checking in their own passes?**
This is the main attack, because the organizer also earns the organizer share. Sponsors either approve each event by hand or open a campaign only to organizers with a minimum bond, and a sponsor can challenge an organizer so the arbitrator slashes the bond to the sponsor. Arbitration is the protocol Safe in v1, which is centralized, and we say so plainly. The sponsor report also flags soft signals, such as check-in bursts no real queue could produce.
Proof: `packages/contracts/src/OrganizerBond.sol`, `docs/INTERFACES.md` 2.6, `docs/SECURITY.md` "Self-dealing organizers".

**17. Paying attendees attracts farmers. Why pay them at all?**
The attendee share is what turns a guest pass into a QIE Wallet user, because withdrawing is the moment they connect a wallet. Sponsors choose the split per campaign anywhere from zero to all of it, so a sponsor worried about farming can pay only the organizer and still get verified reach. Per-head amounts are small (our pools pay `[[FILL: per-presence amount and token]]`), which keeps the prize low compared with the effort of physically standing at a door.
Proof: `attendeeShareBps` in `docs/INTERFACES.md` 2.5.

**18. How would a sponsor spot farming after the fact?**
The sponsor report flags patterns that are cheap for us to compute and hard for a farmer to avoid: many passes from one IP, check-ins faster than a door queue can move, passes that never link a wallet, and check-ins at the very edge of the event window. These are labelled as soft signals everywhere, because they are hints and not proof. A sponsor who sees them can revoke the event for future payouts and challenge the organizer's bond.
Proof: `docs/SECURITY.md` soft signals, sponsor report at `/api/campaigns/[id]/report`. `[[FILL: list the anomaly flags that actually shipped]]`

**19. Your Judges' desk QR is on a public screen. Isn't that farmable?**
Yes, by design it is the one event anyone can reach from a screen, so a judge can try the flow from anywhere. It is paid from a small team-funded pool, capped at `[[FILL: capacity]]` check-ins, and `[[FILL: excluded from, or labelled separately on]]` the traction page so it never inflates our numbers. Treat it as a working demo of the flow, not as evidence of traction.
Proof: Judges' desk event `[[FILL: event id with explorer link]]`, `/traction`.

## Proof modes

**20. Mode 1 can be beaten by someone streaming the door screen. Why ship it?**
Because it is the only mode that needs no staff, runs from a projector and moves a crowd of hundreds, which is what most community events look like. Freshness is enforced on-chain against block time, so screenshots, old photos and forwarded links die within the event's pass age, and what remains is a live accomplice in the room streaming to someone outside. Sponsors who care set `minProofMode` to 2, and the vault then refuses to pay mode 1 presences with `NotPresent`. We wrote this into SECURITY.md instead of hiding it.
Proof: `docs/INTERFACES.md` 2.1, `docs/SECURITY.md` "Proof of presence, honestly".

**21. How does mode 2 work, and what if the venue has no internet?**
The attendee shows a code from their pass (`SM2.{eventId}.{attendee}.{signature}`), staff scan it, and the door key signs `DoorAttest(eventId, attendee, attestedAt)`, which binds the proof to that one address. The door app queues attestations when offline and submits them in batches of up to 50 once it reconnects, any time until three days after the event ends. The contract accepts an attestation time from an hour before the start to an hour after the end, and never more than 30 seconds ahead of block time.
Proof: `apps/web/src/lib/qr/payload.ts` (`encodeAttendeeCode`), `/api/relay/check-in/batch`, `docs/INTERFACES.md` 2.1.

**22. Why is the door QR a URL, and how long is a pass valid?**
The QR is a plain link (`/c/{eventId}.{issuedAt}.{signature}`), so any phone camera opens it straight into the check-in page with no app. The door re-signs every 15 seconds, each event sets `maxPassAge` between 30 and 600 seconds, and the contract rejects a pass older than that against block time. The organizer picks it per event, trading strictness against slow mobile data in a crowded hall. We ship a default of `[[FILL: default maxPassAge]]` seconds because `[[FILL: reason from the load test or real events]]`.
Proof: `apps/web/src/lib/qr/payload.ts` (`doorPassUrl`), `docs/INTERFACES.md` 2.1 and 2.3.

**23. What if the door laptop's clock is wrong, or the chain is slow?**
The contract allows a door time up to 30 seconds ahead of block time to absorb small clock drift and rejects anything further ahead. Freshness is measured against the block that includes the check-in, so slow confirmation eats into the pass age, but at about 3.6 seconds a block there is plenty of margin with a pass age of a minute or more. If the relayer is backed up, the signed check-in still counts as long as it is mined inside the pass age.
Proof: `docs/INTERFACES.md` 2.1. The organizer playbook tells organizers to set the door laptop's clock to automatic.

## Business model

**24. How do you make money?**
A protocol fee on each settled presence, taken before the split, fixed when the campaign is created and capped at 5 percent in the contract. We launch at `[[FILL: fee in basis points]]` and the fee goes to `[[FILL: fee recipient, for example the protocol Safe]]`. We earn nothing on no-shows, so our revenue only grows when sponsors get real people.
Proof: payout rules and `setFee` in `docs/INTERFACES.md` 2.5, invariant 7.

**25. Why would a sponsor switch from a flat sponsorship fee?**
Because they stop paying for people who did not come, and every line of their report is a transaction they can open themselves. Organizers who really fill rooms can prove it and ask for more next time, which a flat fee never lets them do. Switching is cheap: a sponsor funds a campaign from QIE Wallet, approves events, and pulls back unspent budget three days after the campaign ends.
Proof: sponsor console under `/sponsor`, `refund` in `docs/INTERFACES.md` 2.5.

**26. Why does this need a blockchain?**
Three things a database cannot give a sponsor: the escrow is neutral, so neither side can change the deal after people show up; every presence and payout is a public receipt the sponsor can audit without trusting the organizer or us; and other contracts can read presence through `IPresence` to gate their own rewards. QIE makes it practical, because a check-in costs a fraction of a cent in gas and confirms in a few seconds.
Proof: `packages/contracts/src/interfaces/IPresence.sol`, `docs/INTERFACES.md` 2.7.

**27. Most attendees don't care about crypto. How do you get them through?**
They do not need to. The first check-in creates a guest pass on the phone with no wallet, no install and no gas, and the stamp lands in seconds. Crypto only appears when they want to withdraw a reward, and at that point they connect QIE Wallet once. The traction page reports how many guests take that step, so you can see whether the funnel works.
Proof: `docs/DECISIONS.md` D-006, conversion rate on `/traction`.

**28. Who pays you first, and how do you grow beyond your own events?**
Our first campaigns are funded by our own team and labelled that way, and `[[FILL: outside sponsors so far, named only if they agreed]]`. We grow along the distribution we already have, the campus sessions, city meetups and sponsored events on our calendar through March, where the organizer is us or someone we know. The next market is brand activations and store visits, where a door at a shop entrance turns the same contract into pay per walk-in.
Proof: `docs/MILESTONES.md`.

## Traction

**29. How many real users do you have, and how can I check?**
As of `[[FILL: date]]`, `[[FILL: verified attendees]]` distinct passes have verified presence across `[[FILL: events]]` events, and `[[FILL: linked wallets]]` of them linked a QIE Wallet. Every number on `/traction` is computed from contract events and links to the transactions on mainnet.qie.digital, so you can recount from the explorer without trusting our database.
Proof: `/traction`, `apps/web/src/server/indexer/`, `docs/INTERFACES.md` section 6.

**30. How much of the money is yours?**
`[[FILL: team-funded total]]` came from pools we funded ourselves and `[[FILL: external total]]` from `[[FILL: number]]` outside sponsors. The traction page shows the two separately, based on whether the sponsor address is one of our published team addresses, and we label it ourselves because you can read the chain anyway.
Proof: `team_funded` and `TEAM_ADDRESSES` in `docs/INTERFACES.md` section 4. Team addresses: `[[FILL: list with explorer links]]`.

**31. Why is your transaction count lower than your check-in count?**
The relayer batches every check-in waiting at the same moment into one `checkInBatch` call and settles them with one `settleBatch`, so a busy door produces fewer transactions than presences. That keeps gas low and the queue moving, and it means our transaction count understates activity. We report both numbers side by side.
Proof: relayer rules in `docs/INTERFACES.md` section 3.

**32. Did you script any check-ins or use bot wallets?**
No. Every mainnet check-in came from a real person at a real event, load tests ran on testnet only, and we never checked in passes we control at events we did not attend. Team members did check in at our internal event and at events they really attended, and those count like anyone else's. The rule is written into our project instructions, because judges read the chain and breaking it would cost us everything.
Proof: `CLAUDE.md` rule 4, testnet load test `[[FILL: link to the load test report and its testnet transactions]]`.

## QIE integration

**33. Why QIE instead of a bigger chain?**
The primitive would work on any EVM chain, but QIE has the pieces it needs in one place: a wallet with names, a stablecoin, price oracles, a DEX and a Safe, plus gas cheap enough that paying per person makes sense. A contract call costs around 0.0001 to 0.0002 QIE and blocks come every 3.6 seconds or so, which is what makes scan to stamp in under ten seconds possible. Our community is also here, so every attendee we bring is a new QIE Wallet user on a chain where that shows up.
Proof: chain facts in `CLAUDE.md` and `docs/MASTER_BRIEF.md` section 2.

**34. QIE Wallet has some odd behaviour. How did you handle it?**
We discover it through EIP-6963 by its `me.qiewallet` identifier and fall back to `window.qie`, and we never trust `window.ethereum` or `isMetaMask`, which QIE Wallet also reports as true. Chain ids are compared as numbers, an empty `accountsChanged` counts as a disconnect because there is no disconnect event, and the page reloads on `chainChanged`. These quirks, plus a 170 kB budget on the check-in route, are why we use viem directly instead of wagmi.
Proof: `apps/web/src/lib/wallet/eip6963.ts` (`discoverWallets`), `apps/web/src/lib/wallet/wallet-store.ts` (`connect`, `ensureChain`), `docs/DECISIONS.md` D-008.

**35. Which integrations actually matter, and which are logos?**
QIE Wallet, QIE ID, QIE, QUSDC, the oracle and the Safe are load-bearing: the vault reads the Zone contract and the oracle on-chain at settlement, escrow is held in QIE or QUSDC, and the Safe owns every contract. QIEDEX funding is `[[FILL: shipped or cut]]` and the MCP server is `[[FILL: shipped or cut]]`, and anything that did not ship is off the slides and out of the README. The integrations table in the submission names the file for each one.
Proof: integrations table in `docs/SUBMISSION.md`.

## Originality

**36. How is this different from POAP or any other attendance badge?**
A badge is a souvenir: it is usually claimed through a link or code that can travel well beyond the room, and it moves no money. Showmark makes the check-in itself the settlement trigger, so the door signs it, freshness is enforced on-chain, the sponsor's escrow pays per person and unspent budget goes back. Our stamps are soulbound too, but they are the receipt, not the product.
Proof: `docs/ARCHITECTURE.md`.

**37. Quest platforms already pay people for actions. Why is this different?**
Quest platforms reward online actions like following an account, making a swap or joining a server, which bots and farms are built to complete at scale. Showmark rewards an action that is expensive to fake, being physically in a room at a set time, with the proof signed by a door key and checked by the chain. The payer also works differently: a sponsor's escrow pays per verified person and refunds the rest, instead of a fixed prize pool for whoever finishes the tasks.
Proof: `docs/SECURITY.md`, `docs/ARCHITECTURE.md` "Proof modes".

**38. Is any of this reused from another project or hackathon?**
No. The repository's first commit is from 19 Nov 2026, inside the hackathon's build window, every contract was written in it during the hackathon, and the history is incremental and never rewritten, so you can watch it being built. OpenZeppelin Contracts, viem and Next.js are dependencies, which the rules allow, and nothing is forked or copied from starter kits or our earlier work.
Proof: `git log --reverse`, `CLAUDE.md` rules 1 and 2.

## The team and the code

**39. How much of this did AI write, and can you explain it without it?**
We built with AI coding agents, which the hackathon FAQ encourages, and the README says so. Each part of the system has a named owner on the team who reviewed and merged its code and drilled on these questions before demo week: `[[FILL: owner per area, for example contracts, relayer and indexer, attendee app, organizer and door, sponsor console, events and traction]]`. Ask any of us to open a file and walk you through it.
Proof: `[[FILL: README section on how it was built]]`, `CLAUDE.md` section 11, pull request descriptions on GitHub.

**40. What is the weakest part of Showmark today?**
Trust in the organizer. Mode 1 can be relayed from inside the room, the organizer controls the door, and disputes go to our Safe, so a sponsor funding a stranger relies on the bond and on our arbitration. The v2 fixes are mode 2 as the default for paid campaigns, arbitration by more than one independent party, and a verified-identity tier if QIE's KYC or trust-score data becomes readable on-chain.
Proof: `docs/SECURITY.md`, roadmap slide in `docs/DECK.md`.

## Drill log

Run one 20-minute drill per owner before 1 Dec. The owner answers their section cold, a teammate asks follow-ups, and any answer that needed the doc goes back on the list.

| Area | Questions | Owner | Drilled on | Gaps found |
|---|---|---|---|---|
| Contracts | 1 to 7, 11 | `[[FILL: name]]` | `[[FILL: date]]` | |
| Security and relayer | 8 to 10, 12, 13 | `[[FILL: name]]` | `[[FILL: date]]` | |
| Sybil and proof modes | 14 to 23 | `[[FILL: name]]` | `[[FILL: date]]` | |
| Business and traction | 24 to 32 | `[[FILL: name]]` | `[[FILL: date]]` | |
| QIE, originality and team | 33 to 40 | `[[FILL: name]]` | `[[FILL: date]]` | |
