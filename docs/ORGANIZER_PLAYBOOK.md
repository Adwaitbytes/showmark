# Organizer playbook

How to run check-in at your event with Showmark. It takes about ten minutes at the venue and ten minutes the day before. A Hindi version is in `ORGANIZER_PLAYBOOK.hi.md`.

The short version: a screen at the door shows a code that changes every 15 seconds. People point their phone camera at it, tap once, and their presence is recorded on QIE Mainnet with a stamp in their passport. They need no app, no wallet and no money for gas. If a sponsor is paying for your event, each check-in also pays you and the attendee from the sponsor's budget.

First draft, 19 Nov 2026. Items marked `[[FILL: ...]]` get confirmed against the live app before the first real event.

## What you need

- A door device: a laptop, tablet or spare phone with an up-to-date Chrome, plugged into power, with sleep and screen lock turned off.
- Internet at the door, from the venue Wi-Fi or a phone hotspot.
- QIE Wallet in Chrome or on your phone to sign in to the organizer console, with a little QIE for the setup transactions (`[[FILL: measured cost of creating an event and authorizing a door key on mainnet]]`).
- A projector or big screen if the room is large. This is optional.
- The printed posters listed below.
- One helper at the door for the first 15 minutes.

## Choosing a proof mode

- **Mode 1, the door QR.** The door screen shows a signed code that changes every 15 seconds and people scan it themselves. It needs no staff and handles a big crowd, so use it for most events. Its one weakness is that someone in the room could live-stream the screen to a friend outside, which is why you never share the door screen online.
- **Mode 2, the door scans you.** Each attendee opens their passport and shows their own code, and your helper scans it with the door device. It is slower, but the proof is tied to that one person, and the door device can queue scans when there is no internet. Use it when a sponsor asks for it, or when the venue has no signal. `[[FILL: confirm where the mode 2 scanner lives in the door screen]]`

If a sponsor's campaign requires mode 2, mode 1 check-ins are still recorded but the sponsor does not pay for them.

## The day before (about 10 minutes)

1. Open `[[FILL: app URL]]/organize` and sign in with QIE Wallet.
2. Create the event with its name, venue, city, start and end time, capacity (how many people the room holds) and proof mode. Check the times twice, because they cannot be changed after the event is created. Check-in opens one hour before the start time and stays open until one hour after the end time.
3. If a sponsor is paying for your event, send them the event link so they can approve it in their campaign.
4. On the device you will use at the door, open the door screen at `[[FILL: app URL]]/door/[[FILL: event id]]` once. It creates a door key inside that browser and asks you to authorize it with one wallet signature. Bring the same device and use the same browser on the day, because the door key lives only there.
5. Set the door device's clock to automatic. A clock that is far off makes codes look expired.
6. Print the posters.

## At the venue (10 minutes)

| Minute | What to do |
|---|---|
| 0 to 2 | Plug in the door device, connect it to the internet, open the door screen, and check that the code changes every 15 seconds. |
| 2 to 4 | Put the screen at the entrance at chest height, facing people as they walk in, away from bright windows. In a big hall, also show the door screen on the projector. |
| 4 to 6 | Tape up the posters, one at the entrance and one next to the screen. |
| 6 to 8 | Have a helper who is really attending check in with their own phone: scan, tap, stamp. The live count should go to 1. |
| 8 to 10 | Walk your door helper through the script and the troubleshooting table below. |

Every check-in is real and recorded on mainnet, so only test with someone who is actually at the event.

## What to print

1. **Entrance poster** (A3 or A4): "Check in here. Point your phone camera at the screen and tap once. No app, no wallet." Add the event name.
2. **Screen poster** (A4, next to the door screen): three steps, "Open your camera", "Point it at the code", "Tap Check in", and a line saying "Stuck? Ask [[FILL: name]] at the door."
3. **Mode 2 staff card**, only if you use mode 2: "Open your passport, show your code, and we will scan it."
4. **Reward card**, only if a sponsor is paying: "You earned [[FILL: amount and token]] for being here. Connect QIE Wallet any time to withdraw it."

Do not print the door QR. It changes every 15 seconds and the chain rejects old codes within minutes, so a printed one stops working almost straight away.

Printable files: `[[FILL: link to the poster PDFs once the organizer kit is made]]`

## What to say to the room (about 45 seconds)

Read this at the start, in your own words:

> Hi everyone, one quick thing before we start. We are checking in with Showmark tonight. On the screen by the door there is a code. Point your phone camera at it, tap the link that pops up, then tap check in. You do not need an app or a wallet, and it costs you nothing. In a few seconds you will get a stamp in your passport, which is your proof that you were here.
>
> (If there is a sponsor.) Tonight [[FILL: sponsor name]] is paying [[FILL: amount]] for every person who checks in, and part of that goes to you. You can withdraw it later by connecting QIE Wallet.
>
> The code changes every fifteen seconds, so a photo of it will not work for friends who are not here. If you get stuck, find [[FILL: name]] at the door.

## During the event

- Compare the live count with the number of people you can see in the room.
- Leave the door screen running until one hour after the end time so late arrivals can still check in.
- Never show the door screen on a livestream, a video call or in a group chat. A live stream is the one way someone outside the room could check in.
- Never check anyone in on someone else's behalf, and never check in phones belonging to people who are not there.

## After the event

1. Close the door screen, open the attendee list in the console and export the CSV.
2. If a sponsor is paying, each payout is credited right after the check-in and shows in the console with an explorer link. Remind attendees they can withdraw any time.
3. If you ran mode 2 without internet, connect the door device to the internet within three days of the event's end time. Queued check-ins are submitted when it reconnects, and after three days they can no longer be recorded.
4. Send the team a few photos (only of people who agreed) and a couple of lines on how it went.

## Troubleshooting

| Problem | What to do |
|---|---|
| The camera does not react to the code | Hold the phone about an arm's length away, wipe the lens, turn the door screen's brightness up and tilt it away from glare. Try Google Lens or the phone's built-in QR scanner, or open `[[FILL: app URL]]/scan` in the browser. |
| The link opened inside Instagram or WhatsApp | Open it in Chrome or Safari instead. The pass is saved in the browser, so people should use the same browser every time. |
| "This code has expired" | Scan again, since the newest code is already on the screen. If it happens to everyone, the door device's clock is wrong or the internet is very slow, so set the clock to automatic and reload the door screen. |
| "Check-in has not opened yet" | Check-in opens one hour before the start time. If the time was set wrong, it cannot be edited, so create a new event and open a door screen for it. |
| "This event is full" | The capacity is reached. Raise it in the console. |
| "Already checked in" | Nothing to fix. Their stamp is already in their passport. |
| The door screen says the door key is not authorized or has expired | Open the console and authorize a door key for this device again, which takes one wallet signature. |
| The door device went to sleep or the browser closed | Reopen the door link in the same browser and the key will still be there. If the browser data was cleared, authorize a new door key. |
| No internet at the venue | Connect the door device to a phone hotspot. If nobody has signal, switch to mode 2: the door device queues each scan and submits it when it is back online. `[[FILL: confirm the attendee's code can be shown offline once Showmark has been opened before]]` |
| A long queue at the door | Open a second door screen on another device at a second entrance or on the projector. Each device needs its own door key, authorized the same way. |
| Someone has no smartphone or a dead battery | They cannot check in themselves. Do not check them in from someone else's phone, because that creates a different person's pass. Note them on paper for your own headcount. |
| A payout is not showing | Presence is recorded either way, but payment can wait if the campaign needs a QIE ID and the attendee has not linked a wallet with one yet, if the sponsor has not approved your event, if the budget has run out, or if a dollar-priced campaign is waiting for a fresh price. The console shows the reason. `[[FILL: confirm whether pending payouts are retried automatically or need a button]]` |
| "What happens to my data?" | The pass is a key stored on their phone. It holds no money and asks for no personal details. The check-in is public on QIE Mainnet against an address, not a name. |

## Rules that are never broken

- Real people at real events only. No checking in passes you control, no scripted check-ins, no events that did not happen.
- Never share the door screen outside the room.
- Never ask anyone for a seed phrase or private key. Showmark never needs one.

These rules protect you, your sponsor and every attendee, and judges and sponsors can read the chain.
