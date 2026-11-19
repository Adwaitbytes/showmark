# Demo video script

First draft, written on 19 Nov 2026 before anything is deployed. The lead refreshes every `[[FILL: ...]]` with real numbers, hashes and names from `docs/EVIDENCE.md` and `/traction` before the final cut on Sat 28 Nov. Nothing in the final video may show a number, address or name that a judge cannot find on the chain or in the repo.

## The brief for this video

- Length: 2:50 target, hard stop at 3:00. The hackathon FAQ lists a demo video as mandatory but sets no length. Our own brief caps it at three minutes.
- Where it goes: the submission form asks for a "Product Video URL" with a YouTube link as the example, so upload to YouTube as public or unlisted (`[[FILL: YouTube URL]]`).
- Voice: one team member reading the lines below in their own voice, recorded close to a phone in a quiet room. No synthetic voice. Read it like you are explaining it to a friend at the venue, not like an advert.
- Captions: burned into the video and also uploaded to YouTube as an `.srt` file. Sentence case, at most two lines, about 42 characters per line.
- Music: none, or one quiet bed under the voice. Keep the room sound from the event clips, because it proves the event was real.
- Footage rule: every check-in shown is a real person at a real event on QIE Mainnet, filmed with their consent. No staged mainnet check-ins, no testnet footage presented as mainnet, no mocked screens.

### Shot types

| Tag | Meaning |
|---|---|
| REAL | Must be filmed at a real event between Thu 26 and Sat 28 Nov. Cannot be recreated in a studio. |
| SCREEN | Screen recording of the production app or the explorer on mainnet. Record at 1920 by 1080 on desktop, native resolution on the phone. |
| TEAM | The team on camera, filmed at an event or anywhere well lit. |

## Script

Timings assume a calm pace of about 150 words a minute. The voiceover is about 410 words.

### 0:00 to 0:11. Cold open (REAL)

- Shot: wide shot of the door screen at the venue with people walking past it, one phone raised toward the QR. Room sound up for the first second, then under the voice.
- Voiceover: "This is [[FILL: event name]] in [[FILL: city]]. Every person who walks through this door earns money from a sponsor's budget, and the sponsor can check each one of them on the chain."
- Caption: "[[FILL: event name]], [[FILL: city]], [[FILL: date]]. QIE Mainnet."

### 0:11 to 0:26. The problem (REAL)

- Shot: the organizer at the entrance with a paper sign-in sheet or a clicker counter, then a slow pan across the room. If the event had no paper sheet, use the pan alone. Do not fake a sponsor slide.
- Voiceover: "Sponsorship usually runs on a number someone typed into a slide. The sponsor pays for the headcount and has no way to check it. We run campus and city events, so we have sat on both sides of that slide."
- Caption: "Sponsors pay for headcounts they cannot check."

### 0:26 to 0:39. The primitive (SCREEN)

- Shot: the landing page hero, then the three-step diagram from the landing page (sponsor escrow, verified presence, split and refund) drawn in ink with the vermilion stamp landing on the middle step.
- Voiceover: "So we built Showmark. A sponsor locks a budget in escrow on QIE, and it only moves when a real person is verified at the door. Whatever nobody earns goes back to the sponsor."
- Caption: "Sponsors pay only for people who actually show up."

### 0:39 to 1:00. The check-in (REAL, then SCREEN on the phone)

- Shot 4a (REAL): over the shoulder of a consenting attendee as they point the phone camera at the door screen.
- Shot 4b (SCREEN, phone): screen recording from that phone of the check-in page opening, the one tap, and the stamp press with its haptic pulse. Record it on the attendee's phone with their permission, or on a team phone in the same queue.
- Shot 4c (SCREEN, phone): tap the transaction link under the stamp so the explorer opens.
- Voiceover: "Here is what that looks like at the door. They point their camera at the screen, tap once, and the stamp lands. They did not install an app, create a wallet or pay for gas, because our relayer covers it. That stamp is a mainnet transaction signed by their phone and by the door."
- Caption: "Scan to stamp in [[FILL: measured seconds from this exact clip]] seconds. No wallet, no gas."
- Note: only show a time in the caption if it is measured from the clip itself. If the clip is cut, drop the number.

### 1:00 to 1:17. The door (REAL, then SCREEN)

- Shot 5a (REAL): close-up of the door screen as the QR changes and the live count ticks up by one.
- Shot 5b (SCREEN): the organizer console with the event's proof mode setting visible, then staff scanning an attendee's code in "door scans you" mode, if that mode was used at a real event. If it was not, show the setting only.
- Voiceover: "The door signs a fresh code every fifteen seconds and the contract checks its age against block time, so a photo from yesterday is useless. Sponsors who want more can require the door to scan each attendee instead, which ties the proof to one person."
- Caption: "Mode 1: a signed code that rotates every 15 s. Mode 2: the door scans you."

### 1:17 to 1:35. The sponsor's payout (SCREEN)

- Shot 6a: the sponsor console for `[[FILL: campaign name]]`, showing verified reach and the list of payouts, each with an explorer link.
- Shot 6b: click one payout row. The explorer opens on the settlement transaction. Zoom to the `Settled` log showing the attendee amount, the organizer amount and the fee.
- Shot 6c: the campaign's remaining balance and the refund date.
- Voiceover: "On the sponsor's side, every presence is a payout with a link. This one sent [[FILL: attendee amount and token]] to the attendee and [[FILL: organizer amount and token]] to the organizer, straight from escrow. When the campaign ends, the sponsor takes back whatever is left."
- Caption: "Settled on QIE Mainnet, tx [[FILL: first 6 and last 4 characters of the settlement hash]]."

### 1:35 to 1:47. The passport (SCREEN on the phone)

- Shot: the attendee's passport with its address-seeded guilloche, the stamps with their slight rotation and ink edge, and a streak if the person has one. Then the "connect QIE Wallet" step and the passport picking up the `.qie` name.
- Voiceover: "Attendees keep a passport of every place they actually showed up. When they want their rewards, they connect QIE Wallet once, and their .qie name goes on the passport."
- Caption: "Soulbound stamps. From guest to QIE Wallet in one step."

### 1:47 to 2:02. Traction (SCREEN)

- Shot: `/traction` on desktop, slow scroll from the headline numbers to the split between team-funded pools and outside sponsors.
- Voiceover: "Our traction page reads everything from the chain. So far that is [[FILL: verified attendees]] verified people at [[FILL: events]] events, [[FILL: new QIE Wallet users]] new QIE Wallet users and [[FILL: Showmark transactions]] mainnet transactions, with our own pools labelled apart from outside sponsors."
- Caption: "Live from QIE Mainnet, as of [[FILL: date and time of recording]]."

### 2:02 to 2:20. Integrations (SCREEN)

- Shot: the integrations section of the landing page or README, one component highlighted at a time as the voice names it, each with a quick cut to where it shows up in the product (wallet sheet, `.qie` name on a passport, QUSDC campaign, USD-priced campaign, QIEDEX quote, Safe owner on the explorer).
- Voiceover: "Showmark uses QIE where the product needs it: QIE Wallet to sign in and withdraw, QIE ID for names and as an optional gate, QIE and QUSDC for escrow, the oracle for dollar budgets, QIEDEX to fund from any token, and a Safe that owns every contract."
- Caption: "QIE Wallet, QIE ID, QIE, QUSDC, Oracles, QIEDEX, Safe."
- Note: before the final cut, remove any component that did not ship to mainnet. `[[FILL: confirm QIEDEX funding shipped, otherwise cut it from this line and the caption]]`

### 2:20 to 2:33. Team and the next 90 days (TEAM)

- Shot: the team together at an event, ideally beside a door screen, then a two-second cut to the 90-day calendar from `docs/MILESTONES.md`.
- Voiceover: "We are [[FILL: team name]], [[FILL: number]] builders from [[FILL: colleges or cities]]. Over the next 90 days we are taking Showmark to [[FILL: number]] events on our calendar, adding streaks for the regulars and [[FILL: third plan item from MILESTONES.md, for example the first store-visit pilot]]."
- Caption: "[[FILL: team name]]. 90-day plan: [[FILL: number]] events from 10 Dec."

### 2:33 to 2:50. Try it (SCREEN, end card)

- Shot: the Judges' desk door page on a laptop with the live rotating QR, then the end card: Showmark wordmark on paper, the app URL and the repo URL in monospace.
- Voiceover: "Try it yourself. Open [[FILL: short Judges' desk URL]] on a laptop, scan it with your phone, and you will have a stamp on QIE Mainnet in under a minute."
- Caption: "[[FILL: app URL]] and [[FILL: repo URL]]"
- Note: never show a frozen QR in the video as something to scan. The door QR expires after the event's pass age, so a QR in a video is dead by the time anyone watches. Show the URL instead.

## Shot list

| ID | Type | What | Where and when | Device | Must have |
|---|---|---|---|---|---|
| S1 | REAL | Wide of the door screen with people passing | First real event, 26 to 28 Nov | Phone on a small tripod, landscape, 4K if possible | Live count visible, no one's face without consent |
| S2 | REAL | Organizer at the entrance, room pan | Same event | Phone, handheld, slow | Real crowd, real venue signage |
| S3 | SCREEN | Landing hero and three-step diagram | Production URL on desktop | Desktop recorder at 1920 by 1080 | Final copy, no lorem ipsum |
| S4a | REAL | Over-shoulder scan of the door QR | Any real event | Second phone filming the first | Consent from the attendee |
| S4b | SCREEN | Check-in to stamp press, recorded on the attendee phone | Same moment as S4a | Phone screen recorder, haptics on | Uncut from scan to stamp so the time is honest |
| S4c | SCREEN | Explorer page for that check-in | Phone | Phone screen recorder | Hash visible |
| S5a | REAL | Door screen close-up as the QR rotates and the count ticks | Any real event | Phone, steady | At least one full 15 s rotation |
| S5b | SCREEN or REAL | Proof mode setting, staff scanning in mode 2 | Organizer console, plus a real event if mode 2 was used | Desktop and phone | Only show mode 2 at an event if it really ran there |
| S6a | SCREEN | Sponsor console campaign page | Production, after the event | Desktop | Real campaign with real payouts |
| S6b | SCREEN | Explorer settlement transaction with the `Settled` log | mainnet.qie.digital | Desktop, zoomed to 125 percent | Amounts readable |
| S6c | SCREEN | Remaining balance and refund date | Sponsor console | Desktop | |
| S7 | SCREEN | Passport, link QIE Wallet, `.qie` name appears | Production on a phone | Phone screen recorder | A real attendee's passport, with consent, or a team member's |
| S8 | SCREEN | `/traction` scroll | Production on desktop | Desktop | Recorded the day of the final cut, timestamp in caption |
| S9 | SCREEN | Integrations, one cut per component | Production and explorer | Desktop and phone | Only components live on mainnet |
| S10 | TEAM | The team at an event | Any real event | Phone on tripod | Everyone in frame, names in lower thirds |
| S11 | SCREEN | Judges' desk door page and end card | Production | Desktop | URL readable at phone size |

## Footage that needs a real event

S1, S2, S4a, S4b, S4c, S5a and S10 can only come from a real event. S5b needs a real event only if we show mode 2 in use. Plan to film at the first two events in the calendar, so a bad take at one can be replaced from the other. `[[FILL: the two events we will film at, with dates]]`

## On the day of filming

1. Ask before filming anyone, and keep a note of who agreed. Blur anyone in frame who did not.
2. Turn on the phone's screen recorder before the scan, not after, so the time from scan to stamp is real and uncut.
3. Keep the phone's status bar visible in S4b. It shows the time and the network, which makes the clip believable.
4. Copy every transaction hash you film into `docs/EVIDENCE.md` the same day.
5. Film a few spare seconds of the door screen with nobody in front of it, for transitions.

## Edit checklist

- [ ] Total length under 3:00.
- [ ] Every number on screen matches `/traction` at the recording time, and the caption says when.
- [ ] Every hash on screen opens on mainnet.qie.digital.
- [ ] Captions follow the copy rules: no dashes, no exclamation marks, no emoji, no banned words.
- [ ] Faces only of people who agreed.
- [ ] No component named that is not live on mainnet.
- [ ] YouTube title: "Showmark: sponsors pay only for people who actually show up". Description: the app URL, repo URL and contract addresses.
