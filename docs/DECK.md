# Team presentation

Ten slides for demo week (1 to 5 Dec). First draft, 19 Nov 2026. The lead builds this as a live page in the app later, so slide 3 can embed the real door screen and slide 6 can read `/traction` directly. Every `[[FILL: ...]]` is replaced with a real value before the presentation, and anything we cannot link to the chain or the repo comes off the slide.

## Visual system for every slide

- Canvas: warm paper (`--paper` #F3EFE6) with a faint paper grain, 16:9. Dark "night desk" variant (`--night` #12110F) only if the room is dark.
- Ink: all text, rules and diagrams in ink black (`--ink` #141311), secondary text in `--ink-soft` #4A4640.
- Accent: one vermilion mark per slide at most (`--vermilion` #E4442B), used for the single thing the eye should land on. Stamp blue (`--stamp-blue` #2B4BD9) only for links and data marks. Ledger green (`--ledger-green` #1F6B45) only for "settled".
- Type: headlines in Instrument Serif, large and in sentence case. Body in Geist. Every number, address, amount and hash in Geist Mono.
- Furniture: a perforated edge along the bottom of each slide like a ticket stub, a small slide number set in mono in the bottom right like a page in a passport, and the Showmark wordmark bottom left.
- Never: gradients, glass panels, glow, emoji, stock photos of crowds, 3D shapes, bullet lists longer than four lines.

Speaker notes are written to be spoken in about 30 seconds per slide, which leaves time for the live demo on slide 3.

---

## Slide 1. Problem

**Headline:** Sponsors pay for headcounts nobody can check

**On the slide:**

- A sponsor funds an event and gets back a number, a few photos and a thank-you slide.
- Nobody can tell how many of those people were really there, so sponsors guess and organizers inflate.

**Speaker notes:** "We run campus sessions and city meetups, and every sponsor conversation ends the same way. They ask how many people came, we give them a number, and they have to take our word for it. Next time they fund less, because they can't tell the good organizers from the ones who round up. [[FILL: one real, specific story from our own events, told with the sponsor's permission or anonymized]]"

**Visual:** A paper attendance sheet drawn in ink line art, with a handwritten headcount struck through by a single vermilion line. Nothing else on the slide.

---

## Slide 2. The primitive

**Headline:** Money that moves only when a person is at the door

**On the slide:**

- A sponsor locks a budget in escrow on QIE.
- Each verified presence pays a fixed amount, split between the organizer and the attendee.
- Whatever nobody earns goes back to the sponsor.

**Speaker notes:** "Showmark is presence-conditional payment. The sponsor's money sits in a contract, and the only thing that releases it is a person being verified at a real door at a real time. The attendee gets a share, the organizer gets a share, and the sponsor gets back every unit nobody earned. Attendance badges exist and quest platforms exist, but escrowed sponsorship that settles per verified person is new."

**Visual:** Three boxes in a horizontal ledger line: "Escrow", "Presence", "Split and refund". A vermilion ink stamp, slightly rotated with a bleed edge, lands on "Presence". Amount labels in mono under the arrows.

---

## Slide 3. Live demo

**Headline:** Check in now, from your own phone

**On the slide:**

- Judges' desk, event `#[[FILL: Judges' desk event id]]` on QIE Mainnet.
- Point your camera at the code, tap once, and the stamp lands in a few seconds.
- Reward per check-in: `[[FILL: amount and token]]`, from a team-funded pool.

**Speaker notes:** "This code is live. It is the real door screen for our Judges' desk event, and it re-signs itself every fifteen seconds. Scan it with your phone camera, no app and no wallet needed. [pause while judges scan] You can watch the count go up on the right. Each of those is a mainnet transaction you can open on the explorer. One honest note: if you are scanning this through a video call, you are doing exactly what our weaker proof mode cannot stop, which is someone relaying the door screen. That is why sponsors can require mode 2, where the door scans you instead."

**Visual:** The live door screen embedded at full height on the right two-thirds of the slide (rotating QR and the live count as the centerpiece, readable from the back of the room). On the left, the three lines above and a mono line with the event id. If the embed fails, follow `docs/DEMO_RUNBOOK.md`.

---

## Slide 4. How it works

**Headline:** Two signatures in, one stamp and one payout out

**On the slide:**

- The door signs a pass every 15 s, the attendee's phone signs the check-in, and our relayer pays the gas.
- `ShowmarkRegistry` checks both signatures, the door key and the pass age against block time, then records presence once and mints a soulbound stamp.
- `CampaignVault` settles each funded campaign in a separate transaction, so a broken campaign can never block a check-in.

**Speaker notes:** "Two keys sign every check-in. The door key lives only in the door screen's browser and is authorized on-chain by the organizer for that one event. The attendee's pass key lives on their phone and never needs gas. The registry checks both, checks that the door pass is fresh against block time, and records presence at most once per person per event. Payment happens in the vault, in its own transaction right behind it, usually in the same 3.6 second block. We split them on purpose: a paused vault, an empty budget or a stale oracle can delay a payout, but it can never stop someone being checked in."

**Visual:** The architecture diagram from `docs/ARCHITECTURE.md` redrawn in ink on paper: door, phone, relayer, registry, stamp, vault, wallet. Contract names in mono. The `checkInBatch` arrow in vermilion. A small ledger-green tick on `settleBatch`.

---

## Slide 5. QIE integrations

**Headline:** Built on QIE where the product needs it

**On the slide:** a table, one row per component.

| Component | What it does in Showmark |
|---|---|
| QIE Wallet | Sign in for organizers and sponsors, and where attendees withdraw |
| QIE ID | Names on passports and an optional gate checked on-chain at settlement |
| QIE and QUSDC | Escrow and payouts in native QIE or the QIE stablecoin |
| Oracles | Dollar budgets paid in QIE at the settlement-time price, with a staleness check |
| QIEDEX | Fund a campaign from any listed token `[[FILL: shipped or cut]]` |
| Safe | Owns every contract and arbitrates organizer bonds |
| Wallet MCP and our MCP | Agents can read verified reach next to wallet data `[[FILL: shipped or cut]]` |

**Speaker notes:** "Every component is here because the product breaks without it. QIE ID is not a logo on the page: the vault reads the Zone contract at settlement and refuses to pay a gated campaign if the linked wallet holds no name. The oracle is read on-chain with a staleness limit we set from the feed's real history, so a stale price waits instead of mispricing. The Safe on safe.qie.digital owns every contract, so no single team member can pause the protocol."

**Visual:** The table set like an official form with ruled lines and mono component names. Each row has a tiny ink stamp icon. Rows that did not ship are removed, not greyed out.

---

## Slide 6. Traction

**Headline:** Real people, read straight from the chain

**On the slide:** four large mono numbers, each with its label and a link.

- `[[FILL: verified attendees]]` verified attendees across `[[FILL: events]]` real events
- `[[FILL: new QIE Wallet users]]` new QIE Wallet users (guests who linked a wallet: `[[FILL: conversion rate]]`)
- `[[FILL: people with two or more events]]` people who came back for a second event
- `[[FILL: Showmark transactions]]` mainnet transactions, `[[FILL: share]]` of the chain's daily transactions on `[[FILL: date]]`
- Funding: `[[FILL: team-funded total]]` from our own pools, `[[FILL: external total]]` from `[[FILL: number]]` outside sponsors.

**Speaker notes:** "Every number on this slide is a query against QIE Mainnet that you can repeat yourself on our traction page. We label the pools we funded ourselves separately from outside sponsors, because judges read the chain and we would rather tell you first. [[FILL: one sentence on the most interesting real event so far, for example the largest room or the first outside sponsor]]"

**Visual:** The `/traction` headline numbers rendered live in Geist Mono at display size on paper, each with a stamp-blue "view on explorer" link. A thin rule separates "team-funded" from "external sponsors". If the live read fails, a static snapshot with its timestamp.

---

## Slide 7. Business model

**Headline:** We earn only when a real person shows up

**On the slide:**

- A protocol fee on each settled presence, set per campaign and capped at 5 percent in the contract. Launch fee: `[[FILL: fee in basis points]]`.
- Sponsors pay a cost per verified attendee instead of a flat fee for a guessed headcount.
- First market: campus and city events we already run. Next: brand activations and store visits, where the same contract pays for a verified walk-in.

**Speaker notes:** "Our revenue is a fee on settled sponsorship, so we only make money when a sponsor gets a real person. The cap is hard-coded at 5 percent and fixed per campaign when it is created, so we cannot raise it on a sponsor mid-campaign. We start where we have distribution, our own campus and city events, and the next step is retail: a store visit is the same primitive with a door at the shop entrance. [[FILL: any real sponsor conversation or letter of intent, only if it exists]]"

**Visual:** A receipt drawn in ink, itemized in mono: "verified presence", "attendee share", "organizer share", "protocol fee", "refunded to sponsor". The fee line carries the vermilion mark.

---

## Slide 8. Security

**Headline:** What we protect, and what we do not

**On the slide:**

- Contracts are immutable and owned by a Safe, and pausing never blocks refunds or withdrawals.
- Ten invariants with Foundry fuzz and invariant tests, plus an independent review: `[[FILL: findings count and status]]`.
- Honest limits: mode 1 can be relayed by someone streaming the door screen, arbitration is centralized in v1, and a free QIE ID is a weak sybil filter on its own.

**Speaker notes:** "We wrote down ten invariants before writing the contracts, for example that a sponsor can always refund after the campaign plus three days even when we are paused, and every one has a test. A separate review agent that did not write the code tried to break them, and the results are in SECURITY.md. We are also upfront about the limits. The rotating code kills screenshots but not a live stream, so sponsors who care require the door to scan each person. Bond disputes are decided by our Safe for now. And free names are cheap, so the real sybil defense is presence itself, the organizer's bond and the sponsor choosing who to fund."

**Visual:** A two-column ledger page: "Enforced on-chain" on the left with ledger-green ticks, "Known limits" on the right in ink with a vermilion margin mark. Invariant numbers in mono.

---

## Slide 9. Roadmap

**Headline:** The next 90 days are already on the calendar

**On the slide:**

- 10 Dec to 10 Mar: `[[FILL: number]]` events across `[[FILL: campuses and cities]]`, mapped to four milestone types in `docs/MILESTONES.md`.
- Series and streaks for recurring meetups, so regulars are visible on-chain.
- `IPresence` and the SDK, so any QIE contract can gate on real-world presence.
- Next: store-visit pilots, a verified-identity tier through QIE Pass `[[FILL: only if sandbox keys arrived]]`, and handing arbitration to more than one party.

**Speaker notes:** "The hackathon pays half the prize after three traction milestones in 90 days, and we planned for four. Each one has an on-chain metric and a tile on the traction page, so you can check our progress without asking us. [[FILL: name the two biggest events in the plan and their expected size]]"

**Visual:** A calendar page from a passport, three months in a row, with each planned event as a small ink stamp outline. Past events from the hackathon week are filled stamps. The 10 Dec start date carries the vermilion mark.

---

## Slide 10. Team

**Headline:** The people who run the doors also wrote the code

**On the slide:** one row per person, set like passport data pages.

| Name | Owns | |
|---|---|---|
| `[[FILL: name]]` | `[[FILL: area, for example contracts]]` | `[[FILL: college, student yes or no]]` |
| `[[FILL: name]]` | `[[FILL: area]]` | `[[FILL: college]]` |
| `[[FILL: name]]` | `[[FILL: area]]` | `[[FILL: college]]` |
| `[[FILL: name]]` | `[[FILL: area]]` | `[[FILL: college]]` |

- Built with AI assistance, which the hackathon encourages. Every area has a named human owner who reviewed and merged its code and can explain it today.
- Repo: `[[FILL: repo URL]]`. App: `[[FILL: app URL]]`.

**Speaker notes:** "We are [[FILL: team name]]. Each of us owns one part of the system and can take any question on it right now. [[FILL: who answers contracts, who answers the relayer, who answers events and traction]]. Thank you. The Judges' desk is still open if you want a stamp."

**Visual:** Each team member as a passport data page with a small ink-line portrait or initials in a guilloche frame seeded by their wallet address, name in serif, role in Geist, wallet or `.qie` name in mono. No stock photos.

---

## Build notes for the live page

- Slide 3 embeds `/door/[[FILL: Judges' desk event id]]` in an iframe or renders the door component directly. The door key must be authorized and valid through 5 Dec. Check the night before.
- Slide 6 reads the same server query as `/traction` (`getTraction()` in `apps/web/src/server/queries.ts`) and falls back to the last snapshot with its timestamp.
- Arrow keys and a clicker move between slides. Each slide must be readable at 1280 by 720 from three metres away.
- Run the copy check from `docs/MASTER_BRIEF.md` section 8 on the final text.
