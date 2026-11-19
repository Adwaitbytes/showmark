# Live demo runbook

Five minutes, live on QIE Mainnet, for demo week (1 to 5 Dec). Every step has a fallback, so nothing that breaks on stage costs more than ten seconds. First draft, 19 Nov 2026.

Production is frozen after Mon 30 Nov, 20:00 IST. Nothing in this runbook involves deploying, migrating or changing configuration. If something is broken in production during demo week, we demo around it and say so.

Demo slot and format: `[[FILL: date, time (with time zone) and whether it is in person or a video call]]`

## Roles

| Role | Who | Job |
|---|---|---|
| Presenter | `[[FILL: name]]` | Talks, drives laptop A and the deck |
| Operator | `[[FILL: name]]` | Does the live check-in on phone A, mirrored to the screen, and watches the door screen |
| Backup | `[[FILL: name]]` | Holds phone B and the hotspot, keeps the fallback tabs ready, watches the clock and the chat if remote |

## Kit

- Laptop A: the live deck (from `docs/DECK.md`), with these tabs already open and signed in: the Judges' desk door screen, the sponsor console for the Judges' desk campaign, `/traction`, and a settlement transaction from a real event on mainnet.qie.digital.
- Laptop B or a tablet: a second copy of the Judges' desk door screen, using its own authorized door key, as the spare door.
- Phone A (operator): mid-range Android, fresh browser profile with no Showmark pass, so the audience sees the guest flow from zero. Screen mirroring set up (USB mirroring for Android or a webcam pointed at the phone, `[[FILL: chosen method]]`).
- Phone B (backup): a pass already linked to QIE Wallet with a `.qie` name, a few stamps and a small claimable balance, ready to show the passport and a withdrawal.
- A phone hotspot with mobile data, separate from the venue Wi-Fi.
- HDMI and USB-C adapters, chargers for everything.
- Offline fallbacks on laptop A and on a USB stick: the deck as a PDF, the demo video, clips S4b (check-in), S6b (settlement on the explorer) and S7 (passport) from `docs/DEMO_SCRIPT.md`, and screenshots of `/traction` and key transactions from `docs/EVIDENCE.md`.
- A printed card with the Judges' desk URL, to hand to judges in the room.

## Checks

### The day before

- [ ] The Judges' desk event window covers the whole demo week (check-in only works from one hour before its start to one hour after its end). Event id `[[FILL]]`, ends `[[FILL]]`.
- [ ] Both door keys (laptop A and laptop B) are authorized and valid until after the last demo slot.
- [ ] Judges' desk capacity has room for every judge plus spare: `[[FILL: capacity]]`, `[[FILL: current count]]`.
- [ ] The Judges' desk campaign is funded for at least `[[FILL: number]]` more check-ins, ends after demo week, uses token pricing (not USD, so a stale oracle cannot delay judges' payouts), does not require a QIE ID and pays mode 1.
- [ ] Relayer balance is well above the 5 QIE alert line: `[[FILL: balance]]`.
- [ ] Phone B can withdraw: its claimable balance is above zero and its wallet is linked.
- [ ] A full dry run of the five minutes on the production URL, timed, with one fallback rehearsed per step.

### 60 minutes before

- [ ] Charge everything. Turn off sleep, screen lock, notifications and auto-updates on all devices.
- [ ] Laptop clocks set to automatic time.
- [ ] Do one real check-in at the Judges' desk from the backup's own phone if they have not checked in there yet, and confirm the stamp and the payout land.
- [ ] Confirm `/traction` loads and the numbers match the deck.

### 15 minutes before

- [ ] Sign in to the sponsor console again. Sessions expire after 15 minutes without activity, so refresh it again 2 minutes before going on.
- [ ] Phone A: fresh browser profile, camera permission already granted to the browser, brightness up, mirroring on.
- [ ] Projector at its native resolution, door screen readable from the back row.
- [ ] Hotspot on and tested on phone A.

## Run of show

| Time | Step | Show | Say (in your own words) | Success looks like | If it fails |
|---|---|---|---|---|---|
| 0:00 to 0:30 | 1. Problem and primitive | Slides 1 and 2 | Sponsors pay for headcounts nobody can check. Showmark pays only for people at the door, and refunds the rest. | Judges nodding, not reading | Projector dead: see "Projector" below and keep talking. No live dependency here. |
| 0:30 to 1:45 | 2. Live check-in | Slide 3 with the live door screen. Operator scans with phone A, mirrored | Scan it now with your own phone. Watch the count. Each tick is a mainnet transaction. | Stamp press on phone A within about 10 seconds, count goes up, judges' phones show stamps | Embed blank: open the door screen tab. Phone A fails: phone B or a judge's phone. Slow: keep talking while the pending stamp confirms. All else fails: play clip S4b, then open a real check-in on the explorer. |
| 1:45 to 2:30 | 3. Follow the money | Tap the transaction link on phone A's stamp, then the sponsor console tab | Here is the payout from escrow, split between organizer and attendee, and here is what is left for the sponsor to take back. | Explorer shows the `Settled` log with both amounts | Explorer slow: switch to the pre-opened settlement tab. Explorer down: screenshot from `docs/EVIDENCE.md`. Console asks to sign in: use the campaign report at `/api/campaigns/[[FILL: id]]/report`. |
| 2:30 to 3:15 | 4. Passport and wallet | Phone A's new passport, then phone B: linked QIE Wallet, `.qie` name, withdraw | Guests start with no wallet. When they want their money they connect QIE Wallet once, and the passport takes their name. | Withdrawal transaction submitted, then confirmed | Wallet fails: see "Wallet fails" below. Skip the live withdrawal and open phone B's last `Withdrawn` transaction on the explorer. |
| 3:15 to 3:50 | 5. Traction and integrations | `/traction` tab, then slide 5 | Every number here is read from the chain, and our own pools are labelled apart from outside sponsors. | Numbers load and match the deck | Live read fails: slide 6 snapshot with its timestamp, or the `/traction` screenshot. |
| 3:50 to 4:30 | 6. Business and security | Slides 7 and 8 | We earn a capped fee only when a real person settles. Here is what we protect and what we do not. | Judges ask about limits, which is good | No live dependency. |
| 4:30 to 5:00 | 7. Roadmap, team, close | Slides 9 and 10, then back to slide 3 for questions | Four milestone types in 90 days, each with an on-chain metric. The Judges' desk stays open. | Door screen back on screen for Q&A | No live dependency. |

## Fallback playbooks

### Wallet fails

Symptoms: QIE Wallet not detected, popup never opens, wrong network, the wallet is locked, or the connection is rejected.

1. The attendee check-in never needs a wallet, so step 2 is unaffected. Say so: "This is exactly why check-in does not depend on a wallet."
2. If QIE Wallet is locked, open it and enter its password. If it is on the wrong network, the app asks to switch to QIE Mainnet; accept it.
3. If the wallet still does not connect within ten seconds, stop trying on stage. Show phone B, which is already linked, and open its last withdrawal on the explorer.
4. Never type a seed phrase or import a key on stage or anywhere else.

`[[FILL: the mobile wallet connection path confirmed in Phase 0 (in-app browser, WalletConnect or deep link), and its own fallback]]`

### Network slow

Symptoms: the stamp stays pending, pages load slowly, the explorer times out.

1. Keep talking. The stamp shows as pending until the transaction is mined, which is the honest state, so narrate it: "It is waiting for the next block. Blocks on QIE come about every 3.6 seconds, but this Wi-Fi is slower than that."
2. Switch phone A to the hotspot. Switch laptop A to the hotspot if the deck itself is slow.
3. While it confirms, show the pre-opened settlement tab from a real event.
4. If nothing has confirmed after 30 seconds, play clip S4b and move on. Come back to the stamp at the end, because it will have landed by then.

### Projector

Symptoms: no signal, wrong resolution, the QR is too small or washed out.

1. Swap the cable or adapter, then mirror instead of extend.
2. If the door screen QR is hard to scan from the projector, hold laptop B up to the judges, or hand out the printed card with the Judges' desk URL so judges open the door screen on their own laptop and scan it with their phone.
3. If there is no projector at all, present from laptop A's screen turned toward the judges, with phone A held up for the check-in.
4. Never show a screenshot of the door QR as something to scan. It expires within the event's pass age and the check-in will be rejected.

### Phone camera

Symptoms: the camera does not react to the QR, opens the wrong app, or the link opens inside another app's browser.

1. Move closer, tilt away from glare, raise the door screen's brightness.
2. Use Google Lens or the phone's built-in QR scanner, or open `[[FILL: app URL]]/scan` in the browser.
3. If the link opened inside another app, open it in Chrome.
4. Switch to phone B, or ask a judge who has already checked in to show their phone.

### Chain, RPC or explorer down

1. The app reads through a fallback across five public RPC endpoints, so one endpoint failing should not show. Reload once.
2. If the chain itself is not producing blocks, say so plainly, play the demo video's check-in and settlement clips, and show the evidence screenshots. Do not pretend a live transaction happened.

### Relayer out of gas or check-ins rejected

1. Check-ins will not be relayed if the relayer cannot pay gas. The day-before check makes this unlikely.
2. If it happens, the backup sends QIE to the relayer address `0xAaca310b66413Ebbf240b59dFE75Fb873d903660` from the team wallet. This is a transfer, not a production change.
3. Meanwhile, play clip S4b and continue.

### Door key expired, event closed or at capacity

1. The door screen shows that its key is not authorized or the event is not open. Switch to laptop B's spare door.
2. If both fail, the organizer re-authorizes a door key from the console with one wallet signature, which takes under a minute. Do it after the demo, not during it, and play clip S4b instead.
3. At capacity: raise capacity from the organizer console after the demo, and tell judges the desk will be open again in a few minutes.

### Remote demo over a video call

1. Share laptop A's screen with the deck. Paste the Judges' desk URL in the chat so judges can open the door screen on their own laptop, which scans far better than a compressed video stream.
2. Mirror phone A into the shared screen for the check-in.
3. Say the honest line from slide 3: a QR scanned through a video call is exactly the relay that mode 1 cannot stop, which is why sponsors can require mode 2.

## What to say when something breaks

- "That is the slow path, and it is worth seeing. The stamp is pending because the block has not landed yet. Here is one from [[FILL: real event]] while we wait."
- "The wallet will not open on this machine, so here is the same step on a phone that is already linked."
- "Live demos fail sometimes, so here is the recording from a real event last week, and every transaction in it is on the explorer."

Never claim something worked that the audience did not see working.

## After the demo

- Note what failed, if anything, and which fallback was used, in `docs/STATUS.md`.
- Check the Judges' desk budget and capacity before the next slot.
- Save every judge check-in transaction hash into `docs/EVIDENCE.md`.
