# 90-day milestone plan

From Thu 10 Dec 2026 to Wed 10 Mar 2027. First draft, 19 Nov 2026.

The hackathon pays the second half of any prize after three traction milestones within 90 days, chosen from six types: wallet growth, transaction volume, recurring users, merchants, active monthly usage and revenue. We plan for all six and commit to four (wallet growth, transaction volume, recurring users, active monthly usage), so that missing one still leaves three. Merchants and revenue are stretch goals that depend on outside sponsors saying yes.

Every metric below is computed from contract events on QIE Mainnet, shown on `/traction`, and checkable by anyone on the explorer. Pools funded by the team are labelled apart from outside sponsors in every number that involves money.

Open question for the QIE team before 10 Dec: `[[FILL: what counts as meeting a milestone (thresholds, measurement window, how QIE verifies it) and where we report it]]`. The targets below are placeholders until we know.

## How to set the targets

Targets come from the real calendar, not from ambition. For each milestone, take the events in the calendar below, multiply each event's expected headcount by the check-in rate we measured at the hackathon-week events (`[[FILL: measured check-in rate, verified attendees divided by people in the room, from 26 to 30 Nov]]`), and set the target at that sum. Write the baseline on 10 Dec from `/traction` before any new event runs.

## The six milestones

### 1. Wallet growth (committed)

- What we count: QIE Wallets that link to a Showmark pass, and of those, wallets whose first activity on QIE came through Showmark.
- On-chain proof: `WalletLinked(pass, wallet)` events on `ShowmarkRegistry`. A wallet counts as new to QIE when it had no transaction before its link transaction, which the indexer records as `first_seen_via_showmark` on the profile.
- Where `/traction` shows it: "New wallets first seen through Showmark" and "Passes linked to QIE Wallet", with the guest-to-wallet conversion rate.
- Baseline on 10 Dec: `[[FILL: baseline from /traction on 10 Dec]]`. Target by 10 Mar: `[[FILL: target set from the calendar]]`.
- What drives it: large one-off rooms where most people are new to QIE, so campus sessions, sponsored city events and partner communities' first events. Campaigns that pay the attendee a share give people a reason to connect a wallet and withdraw.

### 2. Transaction volume (committed)

- What we count: mainnet transactions sent to the Showmark contracts, and the value settled through them.
- On-chain proof: transactions to `ShowmarkRegistry`, `CampaignVault` and `OrganizerBond`, counted by the indexer from receipts, and the sum of `gross` in `Settled` events per token. Because check-ins are batched, we also report the number of `CheckedIn` events, which is higher than the transaction count.
- Where `/traction` shows it: "Showmark transactions", "Share of the chain's daily transactions" (from the explorer's `/api/v2/stats`), and "Value settled" per token and in USD.
- Baseline on 10 Dec: `[[FILL: baseline from /traction on 10 Dec]]`. Target by 10 Mar: `[[FILL: target set from the calendar]]`.
- What drives it: every event, but most of all big rooms with a funded campaign, since each presence produces a check-in and a settlement, and every withdrawal is one more transaction.

### 3. Recurring users (committed)

- What we count: people who checked in at two or more distinct events, and people with a streak of two or more inside a series.
- On-chain proof: distinct attendees appearing in `CheckedIn` for at least two different event ids, and the `streak` field of `CheckedIn` (also readable through `streakOf` on `PresenceLens`).
- Where `/traction` shows it: "People with two or more events". `[[FILL: confirm /traction also shows the longest current streak; if not, ask the owner of /traction to add it]]`
- Baseline on 10 Dec: `[[FILL: baseline from /traction on 10 Dec]]`. Target by 10 Mar: `[[FILL: target set from the calendar]]`.
- What drives it: series. Weekly or fortnightly meetups created as a series on-chain, so each session has a series index and regulars build visible streaks on their passports.

### 4. Active monthly usage (committed)

- What we count: distinct people who checked in at least once in the trailing 30 days, and distinct organizers who ran at least one event in that window.
- On-chain proof: distinct `attendee` values in `CheckedIn` events whose block time falls inside the last 30 days, and distinct `organizer` values in `EventCreated` for events with at least one check-in in that window.
- Where `/traction` shows it: `[[FILL: confirm a 30-day active attendees and active organizers tile exists; the data is already in the presences table, so if the tile is missing, ask the owner of /traction to add it before 10 Dec]]`
- Baseline on 10 Dec: `[[FILL: baseline from /traction on 10 Dec]]`. Target for the 30 days ending 10 Mar: `[[FILL: target set from the calendar]]`.
- What drives it: a steady calendar rather than one big spike. Series plus partner organizers keep every 30-day window busy.

### 5. Merchants (stretch)

- What we count: outside businesses that pay through Showmark, meaning external sponsors who fund a campaign that settles at least one presence, and venues that run a paid store-visit pilot.
- On-chain proof: distinct sponsor addresses in `CampaignCreated`, not in our published team address list, that have at least one `Settled` event. Store-visit venues appear as organizers of events whose metadata marks them as a store `[[FILL: agree the metadata field with the lead]]`.
- Where `/traction` shows it: "Sponsors", split into team-funded and external.
- Baseline on 10 Dec: `[[FILL: baseline from /traction on 10 Dec]]`. Target by 10 Mar: `[[FILL: target set from the calendar]]`.
- What drives it: sponsored city events and the store-visit pilot in the last 30 days. Only count a merchant once money has settled, not when they say yes.

### 6. Revenue (stretch)

- What we count: protocol fees earned on settled presences from external sponsors. Fees on our own team-funded pools are reported but not counted as revenue, because that would be paying ourselves.
- On-chain proof: the sum of the `fee` field in `Settled` events, per token, for campaigns whose sponsor is external, paid to the fee recipient `[[FILL: fee recipient address]]` and valued at the oracle price on the day.
- Where `/traction` shows it: `[[FILL: confirm a "Protocol revenue (external)" line exists under value settled; if not, ask the owner of /traction to add it]]`
- Baseline on 10 Dec: `[[FILL: baseline from /traction on 10 Dec]]`. Target by 10 Mar: `[[FILL: target set from the calendar]]`.
- What drives it: external sponsors only. The fee is set per campaign at `[[FILL: launch fee in basis points]]` and capped at 5 percent in the contract.

## Event types and what each one moves

| Event type | Typical setup | Proof mode | Milestones it moves |
|---|---|---|---|
| Campus session | One large room, one door screen on the projector, students who are mostly new to QIE | Mode 1, mode 2 for paid campaigns | Wallet growth, transaction volume, active monthly usage |
| Recurring series (club meetups, study groups, weekly community nights) | Same venue and organizer every week, created as a series on-chain | Mode 1 | Recurring users, active monthly usage, transaction volume |
| Sponsored city event | An outside sponsor funds a campaign, often with a QUSDC budget or a USD price | Mode 2 recommended | Transaction volume, merchants, revenue, wallet growth |
| Partner organizer event | Another community runs Showmark at its own event, after posting a bond | Sponsor's choice | Active monthly usage, wallet growth, transaction volume |
| QIE ecosystem event (for example Hackathon 4, which QIE's roadmap puts in January 2027) | Check-in for builders at a venue, only if QIE agrees | Mode 1 | Wallet growth, transaction volume |
| Store-visit pilot | A shop puts a door screen at the entrance and pays per verified walk-in | Mode 2 | Merchants, revenue, recurring users |

Online events are not used for paid campaigns, because a door QR shown on a video call is exactly the relay weakness of mode 1.

## Calendar

Filled from the real calendar Yathu sends (`docs/NEEDS_FROM_YATHU.md` item 10). Add every event as soon as it is confirmed, and never list an event that is not confirmed.

### Days 1 to 30 (10 Dec to 8 Jan)

Goal: turn the hackathon-week attendees into regulars and start at least two series.

| Date | Event | Type | City | Expected people | Organizer | Sponsor or pool | Milestones |
|---|---|---|---|---|---|---|---|
| `[[FILL: date]]` | `[[FILL: event]]` | `[[FILL: type]]` | `[[FILL: city]]` | `[[FILL: expected people]]` | `[[FILL: organizer]]` | `[[FILL: sponsor or pool]]` | `[[FILL: milestones]]` |
| `[[FILL: date]]` | `[[FILL: event]]` | `[[FILL: type]]` | `[[FILL: city]]` | `[[FILL: expected people]]` | `[[FILL: organizer]]` | `[[FILL: sponsor or pool]]` | `[[FILL: milestones]]` |

Note: `[[FILL: check campus calendars for exams and winter breaks in December and January, and move campus sessions accordingly]]`

### Days 31 to 60 (9 Jan to 7 Feb)

Goal: first partner organizers, first external-sponsor campaigns at the launch fee, and one ecosystem event if QIE agrees.

| Date | Event | Type | City | Expected people | Organizer | Sponsor or pool | Milestones |
|---|---|---|---|---|---|---|---|
| `[[FILL: date]]` | `[[FILL: event]]` | `[[FILL: type]]` | `[[FILL: city]]` | `[[FILL: expected people]]` | `[[FILL: organizer]]` | `[[FILL: sponsor or pool]]` | `[[FILL: milestones]]` |
| `[[FILL: date]]` | `[[FILL: event]]` | `[[FILL: type]]` | `[[FILL: city]]` | `[[FILL: expected people]]` | `[[FILL: organizer]]` | `[[FILL: sponsor or pool]]` | `[[FILL: milestones]]` |

### Days 61 to 90 (8 Feb to 10 Mar)

Goal: the first store-visit pilot, series still running every week, and a clean report to QIE.

| Date | Event | Type | City | Expected people | Organizer | Sponsor or pool | Milestones |
|---|---|---|---|---|---|---|---|
| `[[FILL: date]]` | `[[FILL: event]]` | `[[FILL: type]]` | `[[FILL: city]]` | `[[FILL: expected people]]` | `[[FILL: organizer]]` | `[[FILL: sponsor or pool]]` | `[[FILL: milestones]]` |
| `[[FILL: date]]` | `[[FILL: event]]` | `[[FILL: type]]` | `[[FILL: city]]` | `[[FILL: expected people]]` | `[[FILL: organizer]]` | `[[FILL: sponsor or pool]]` | `[[FILL: milestones]]` |

## Reporting rhythm

- Every Monday: snapshot `/traction` into a dated row below, with a link to one representative transaction per number, so progress is checkable later without our database.
- After every event: the organizer's export goes into the event row, and any anomaly flags from the sponsor report are written down with what we did about them.
- When a milestone is met: send QIE the `/traction` link, the explorer links that prove it, and the date it was met, in whatever form QIE asks for.

| Week of | Verified attendees | New wallets through Showmark | People at 2+ events | 30-day active | Showmark transactions | External sponsors | External fee revenue |
|---|---|---|---|---|---|---|---|
| 7 Dec (baseline) | `[[FILL: verified attendees]]` | `[[FILL: new wallets through Showmark]]` | `[[FILL: people at 2+ events]]` | `[[FILL: 30-day active]]` | `[[FILL: Showmark transactions]]` | `[[FILL: external sponsors]]` | `[[FILL: external fee revenue]]` |

## Rules that do not change after the hackathon

The same rules that protect the win protect the milestone payout. No bot wallets, no scripted check-ins on mainnet, no events that did not happen, no self-dealing loops to pump transaction counts, and load tests on testnet only. A milestone met with inflated numbers is worse than a milestone missed, because QIE can read the chain.
