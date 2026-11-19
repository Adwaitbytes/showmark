# Submission pack

Everything needed to fill the QIE Hackathon 3.0 submission form, ready to paste. First draft, 19 Nov 2026. Yathu submits from the team's registered account; agents only draft. Every `[[FILL: ...]]` is replaced with a real, linkable value before submitting, and anything we cannot link to the chain or the repo is removed.

## Dates (IST unless stated)

| When | What |
|---|---|
| Sun 29 Nov, 22:00 | Submission entered with every field complete |
| Mon 30 Nov, before 20:00 | Numbers and links refreshed once through the form's edit flow, then production is frozen |
| Mon 30 Nov, 23:59 CET (Tue 1 Dec, 04:29 IST) | Official deadline |
| 1 to 5 Dec | Demo week, live demos and judging |
| 10 Dec | Winners and the first 50 percent of prizes |

The form supports editing after submission (the submit page has an update path and the success screen says the submission can be managed from the profile page), so entering early costs nothing.

## Where the fields come from

The submit page at https://hackathon.qie.digital/submit renders in the browser after sign-in, so the field list below was read from its published client bundle (`/_next/static/chunks/app/submit/page-305917d21a78ae91.js`) on 19 Nov 2026, and the mandatory items from the FAQ answers in the home page bundle. Treat this as a strong guide, not gospel: after Yathu signs in, check the live form against this list. `[[FILL: when docs/PHASE0.md lands, reconcile it with this list and note any field it adds]]`

What the public pages say must be submitted:

- FAQ, "What are the mandatory submission requirements?": mainnet deployment, open-source smart contracts, live public app, public repository, demo video, documentation and team presentation.
- Home page quickstart: GitHub repository, live demo URL, deployed contract address and track.
- Terms: built on or integrating QIE, original work created during the hackathon period, a working demo, source code on GitHub, comprehensive documentation, a valid QIE wallet address, one project per team, participants 18 or older.

The form itself has no field for contract addresses or the team presentation, so both go into the project description and the README.

## The form, step by step

### Step 1 of 5: Basic info

**Team Name** (required)

```
[[FILL: registered team name]]
```

**Project Name** (required)

```
Showmark
```

**Project Category** (required, single choice)

Choose **Consumer Apps & Social**. Reasoning below. One quirk in the current form: the option labelled "Consumer Apps & Social" is stored with the internal value `gaming`, and the option labelled "Commerce & Real World" is stored as `social`. Pick by the visible label, then open the dashboard after submitting and check that the category reads "Consumer Apps & Social". If it shows anything else, email info@qie.digital the same day.

**Project Description** (required, free text, no length limit found in the form code)

Paste the full version. If the form rejects it for length, paste the short version and keep the full one in the README.

Full version:

```
Showmark: sponsors pay only for people who actually show up.

Showmark is presence-conditional sponsorship on QIE Mainnet. A sponsor locks a budget in QIE or QUSDC in escrow. An organizer runs a real event with a door screen that shows a signed QR code, re-signed every 15 seconds. Attendees scan it with their phone camera and check in with one tap, with no wallet, no app install and no gas, because our relayer pays. Each check-in records presence on-chain, puts a soulbound stamp in the attendee's passport, and releases the agreed amount from escrow, split between the organizer and the attendee. Whatever nobody earns goes back to the sponsor, so every headcount a sponsor used to take on trust becomes a transaction they can open on the explorer.

How presence is proven: in mode 1 the door shows a rotating signed QR and the contract checks its age against block time, so screenshots and forwarded links do not work. In mode 2 the door scans you: staff scan the attendee's code and the door key signs an attestation bound to that one person, which also works offline. Each campaign chooses the minimum mode it pays for. We state the limits openly in SECURITY.md: mode 1 can be relayed by someone streaming the door screen, bond arbitration is centralized in v1, and a free QIE ID is a weak sybil filter on its own.

QIE integration: QIE Wallet for sign-in and withdrawals, QIE ID for names on passports and as an on-chain gate at settlement, QIE and QUSDC for escrow and payouts, the QIE/USD oracle for dollar budgets paid in QIE with a staleness check, [[FILL: QIEDEX line if shipped, for example "QIEDEX to fund a campaign from any listed token"]], and a Safe on safe.qie.digital that owns every contract. [[FILL: MCP line if shipped]]. The README has the full table with the file for each one.

Try it: open the Judges' desk at [[FILL: Judges' desk URL]] on a laptop and scan it with your phone. You will have a stamp on QIE Mainnet in under a minute.

Live app: [[FILL: production URL]]
Traction, read live from the chain: [[FILL: production URL]]/traction
Repository: [[FILL: repo URL]]
Demo video: [[FILL: YouTube URL]]
Team presentation: [[FILL: deck URL]]
Docs: README, docs/ARCHITECTURE.md, docs/SECURITY.md, docs/JUDGE_QA.md, and an organizer playbook in English and Hindi.

Mainnet contracts (chain 1990, source verified on mainnet.qie.digital):
ShowmarkRegistry [[FILL: address]]
PresenceStamp [[FILL: address]]
CampaignVault [[FILL: address]]
OrganizerBond [[FILL: address]]
PresenceLens [[FILL: address]]
Owner Safe [[FILL: address]]

Traction as of [[FILL: date and time IST]]: [[FILL: verified attendees]] verified attendees at [[FILL: events]] real events, [[FILL: new QIE Wallet users]] new QIE Wallet users, [[FILL: repeat attendees]] people at two or more events, [[FILL: Showmark transactions]] mainnet transactions and [[FILL: value settled]] settled. [[FILL: team-funded total]] came from pools we funded ourselves and [[FILL: external total]] from [[FILL: number]] outside sponsors; the traction page shows the two separately.

Team: [[FILL: names and roles]]. Students: [[FILL: which members are students, and their colleges]].

How we built it: Showmark was built during QIE Hackathon 3.0 with AI-assisted development, which the hackathon FAQ encourages. [[FILL: final AI statement from the section below]]
```

Short version (about 700 characters):

```
Showmark is presence-conditional sponsorship on QIE Mainnet: sponsors lock QIE or QUSDC in escrow, attendees check in at real events by scanning a rotating signed door QR with no wallet and no gas, and each verified presence pays the organizer and the attendee from escrow, with unspent budget returned to the sponsor. Uses QIE Wallet, QIE ID, QIE, QUSDC, the QIE/USD oracle, [[FILL: QIEDEX if shipped]] and a Safe. Contracts: [[FILL: registry and vault addresses]]. App: [[FILL: URL]]. Traction: [[FILL: URL]]/traction. Video: [[FILL: URL]]. Deck: [[FILL: URL]]. Built with AI assistance, which the FAQ allows; every area has a human owner who can explain it.
```

### Step 2 of 5: Links

**LinkedIn Profile** (optional)

```
[[FILL: team lead's LinkedIn URL, or leave empty]]
```

**Project Website** (optional, but fill it: judges must find the live app)

```
[[FILL: production URL]]
```

**GitHub Repository** (required)

```
[[FILL: repo URL. Today it is https://github.com/23f2000979/showmark (docs/DECISIONS.md D-012); use the team org URL if it moves]]
```

**Product Video URL** (required, YouTube link expected)

```
[[FILL: YouTube URL of the final demo video from docs/DEMO_SCRIPT.md]]
```

### Step 3 of 5: Social (all optional)

**Twitter/X Handle**

```
[[FILL: Showmark or team X handle, for example @showmark if claimed]]
```

**Discord Username**

```
[[FILL: team lead's Discord username, or leave empty]]
```

**Telegram Handle**

```
[[FILL: Showmark or team Telegram handle]]
```

### Step 4 of 5: Wallet (required before the submit button works)

**QIE Wallet Address**

```
[[FILL: the team's QIE Wallet address that should be tied to this submission, for example the wallet Yathu controls for prize payouts]]
```

Notes for this step:

- Do not use the deployer or relayer address. Those keys live only in `.env.local` on the build machine and should never be connected to a web page.
- The "Connect QIE Wallet" button calls `window.ethereum`. If MetaMask is also installed in the browser, it may answer instead of QIE Wallet. In that case, type the address into the field by hand.
- Then press "Verify Wallet" and wait until it shows "Verified". In the current form code this button does not ask for a signature, so no wallet popup is expected.

### Step 5 of 5: Review

Read every field once on the review screen, then press "Submit Project". Save a screenshot of the success screen into `docs/EVIDENCE.md`.

## Track choice

We submit under **Consumer Apps & Social**.

The track's own examples are communities, loyalty, identity and monetization, and Showmark's everyday user is a person at a community event collecting stamps in a passport, building streaks and getting a `.qie` name, so this is where the product lives. It is also where our evidence is strongest, because every attendee is a new consumer wallet on QIE. Commerce & Real World (ticketing, merchant payments, POS) is the fallback, since the sponsor side and the store-visit roadmap are commerce, and we would switch only if Phase 0 shows Consumer Apps & Social is far more crowded. DeFi and AI agents are crowded with payments and x402 projects according to the competitor scan, and Developer Infrastructure would undersell a product with real users, even though `IPresence` and the SDK would fit there.

The category choice only affects the $500 category award. First, second and third place and the three special awards (Most Traction, Community Choice, Best Student Team) are listed separately from the tracks. `[[FILL: answer from the QIE team on whether one project can win several awards, and how Best Student Team is decided]]`

## Integrations table

For the README and for judges. Rows marked `[[FILL: shipped or cut]]` are removed from every public document if they did not reach mainnet.

| QIE component | What it does in Showmark | Where in the code | Status |
|---|---|---|---|
| QIE Mainnet and native QIE | All contracts live on chain 1990. Campaign escrow and payouts can be in native QIE, and the relayer pays every attendee's gas in QIE | `packages/contracts/src/`, `apps/web/src/lib/chain/chains.ts`, `apps/web/src/server/relayer/` | Live `[[FILL: confirm]]` |
| QIE Wallet | Sign-in for organizers and sponsors with a wallet signature, linking a guest pass to a wallet, and withdrawing rewards. Discovered through EIP-6963 (`me.qiewallet`) with QIE Wallet's quirks handled | `apps/web/src/lib/wallet/eip6963.ts`, `apps/web/src/lib/wallet/wallet-store.ts`, `/api/auth/*` | Live `[[FILL: confirm]]` |
| QIE ID (Zone contract) | `.qie` names on passports and "Sign in with QIE ID" when a name exists. Campaigns can require a QIE ID, checked on-chain at settlement with `Zone.balanceOf` | `packages/contracts/src/interfaces/IZone.sol`, `packages/contracts/src/CampaignVault.sol` (`NeedsQieId`), `apps/web/src/lib/chain/abi.ts` (`zoneAbi`), `/api/passport/[addressOrName]` | Live `[[FILL: confirm]]` |
| QUSDC | Stablecoin escrow and payouts, 6 decimals, credited by the actual balance change on deposit | `packages/contracts/src/CampaignVault.sol`, `apps/web/src/lib/chain/addresses.ts` | Live `[[FILL: confirm]]` |
| Oracles (QIE/USD feed) | Budgets set in USD and paid in native QIE at the price at settlement, with a staleness and positivity check that defers payment instead of mispricing. Also prices "value settled" on `/traction` | `packages/contracts/src/interfaces/IAggregatorV3.sol`, `CampaignVault.quote`, `apps/web/src/lib/chain/abi.ts` (`aggregatorAbi`) | Live `[[FILL: confirm]]` |
| QIEDEX | Fund a campaign from any listed token by swapping to QUSDC through the router, and let attendees swap rewards in the app, using the public API for quotes and unsigned transactions | `/api/dex/quote` in `apps/web/src/app/api/dex/`, `[[FILL: sponsor funding component path]]` | `[[FILL: shipped or cut]]` |
| Safe (safe.qie.digital) | Owns every contract (pause, fee within the 5 percent cap, stamp URL) and arbitrates organizer bond challenges. The app allows framing only by the QIE Safe so it can run as a Safe App for sponsor treasuries | `apps/web/next.config.ts` (frame-ancestors), `[[FILL: deploy and ownership-transfer script path]]` | Owner live `[[FILL: confirm]]`, Safe App `[[FILL: shipped or cut]]` |
| QIE explorer (Blockscout) | Source verification for every contract, transaction links on every stamp and payout, and the chain's daily transaction count for the share shown on `/traction` | `apps/web/src/server/indexer/`, `[[FILL: traction stats fetch path]]` | Live `[[FILL: confirm]]` |
| QIE RPC endpoints | Reads and writes through a viem fallback transport across the public mainnet RPCs | `apps/web/src/lib/chain/clients.ts` | Live |
| QIE Wallet MCP and the Showmark MCP server | A read-only MCP server for verified reach and campaign data, built to sit next to the QIE Wallet MCP so an agent can answer "how many real people did my campaign reach" | `packages/mcp/`, `/api/mcp` | `[[FILL: shipped or cut]]` |

Not integrated, and why: QIE Pass KYC needs partner sandbox keys `[[FILL: update if keys arrived]]`, and the ISO 20022 gateway has no public endpoint documentation, so both are on the roadmap rather than in the product.

## AI-assisted development statement

For the README "How it was built" section and the last paragraph of the description. The team must read it and edit it until every sentence is exactly true. `[[FILL: team confirms this statement is accurate]]`

```
Showmark was built during QIE Hackathon 3.0 by [[FILL: team name]] with AI-assisted development, which the hackathon FAQ encourages. We used AI coding agents (Claude Code) to write code, tests and documentation from our own product brief, design direction and decisions, which are logged with their reasoning in docs/DECISIONS.md. Every contract was written for this project in this repository during the hackathon; open-source libraries such as OpenZeppelin Contracts, viem and Next.js are used only as dependencies. Each part of the system has a named owner on the team who reviewed and merged its changes and can explain it to a judge: [[FILL: owner per area]]. The commit history is incremental and has never been rewritten, starting from the first commit on 19 Nov 2026. Our answers to the 40 hardest questions about the code are in docs/JUDGE_QA.md.
```

## Mandatory items checklist

| Requirement (source) | Where it is | Done |
|---|---|---|
| Mainnet deployment (FAQ) | Contract addresses above, verified on mainnet.qie.digital, recorded in `docs/EVIDENCE.md` | `[[FILL: yes, with evidence link]]` |
| Open-source smart contracts (FAQ) | `packages/contracts/` in the public repo, and verified source on the explorer | `[[FILL: yes, with evidence link]]` |
| Live public app (FAQ) | `[[FILL: production URL]]`, works on a mid-range Android phone and on desktop | `[[FILL: yes, with evidence link]]` |
| Public repository (FAQ, home page) | `[[FILL: repo URL]]` | `[[FILL: yes, with evidence link]]` |
| Demo video (FAQ) | `[[FILL: YouTube URL]]`, under three minutes | `[[FILL: yes, with evidence link]]` |
| Documentation (FAQ, Terms) | README, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/JUDGE_QA.md`, SDK docs, `docs/ORGANIZER_PLAYBOOK.md` and its Hindi version | `[[FILL: yes, with evidence link]]` |
| Team presentation (FAQ) | `[[FILL: deck URL]]`, built from `docs/DECK.md` | `[[FILL: yes, with evidence link]]` |
| Deployed contract address (home page) | In the description and the README | `[[FILL: yes, with evidence link]]` |
| Track (home page) | Consumer Apps & Social | `[[FILL: yes, with evidence link]]` |
| Valid QIE wallet address (Terms) | Step 4 of the form | `[[FILL: yes, with evidence link]]` |
| Everyone 18 or older, one project per team (Terms, brief) | Confirmed by Yathu | `[[FILL: yes, with evidence link]]` |

## Final refresh on Mon 30 Nov (before 20:00 IST)

1. Read the numbers from `/traction` and update the traction line in the description, the README snapshot and slide 6.
2. Check every link in the description opens, including each contract on the explorer.
3. Confirm the video is public or unlisted and plays signed out.
4. Save the form, screenshot the dashboard entry, and stop touching production.
