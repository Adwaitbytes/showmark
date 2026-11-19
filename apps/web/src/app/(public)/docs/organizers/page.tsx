import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/ui/Prose";
import { DocPager } from "../DocPager";

export const metadata: Metadata = {
  title: "Organizer playbook",
  description: "Run Showmark check-in at a real event in about ten minutes at the venue.",
};

export default function OrganizerPlaybook() {
  return (
    <>
      <Prose>
        <h1>Organizer playbook</h1>
        <p className="lead">
          Running check-in takes about ten minutes the day before and ten minutes at the venue. A screen at the door
          shows a code that changes every 15 seconds, people point their phone camera at it and tap once, and their
          presence is recorded on QIE with a stamp in their passport.
        </p>

        <h2>What you need</h2>
        <ul>
          <li>A door device: a laptop, tablet or spare phone with a current Chrome, on power, with sleep turned off.</li>
          <li>Internet at the door, from the venue Wi-Fi or a phone hotspot.</li>
          <li>QIE Wallet to sign in to the organizer console, with a little QIE for the setup transactions.</li>
          <li>One helper at the door for the first 15 minutes, and a projector if the room is large.</li>
        </ul>

        <h2>Choose a proof mode</h2>
        <p>
          <strong>The rotating door code</strong> needs no staff and handles a big crowd, so use it for most events.
          Its one weakness is that someone in the room could stream the screen to a friend outside, so never show the
          door screen online. <strong>Door scans you</strong> is slower, because staff scan each attendee&apos;s code,
          but the proof is tied to that one person and it works without internet. Use it when a sponsor asks for it.
          Details are in <Link href="/docs/check-in">how check-in works</Link>.
        </p>

        <h2>The day before</h2>
        <ol>
          <li>
            Open the <Link href="/organize">organizer console</Link> and sign in with QIE Wallet.
          </li>
          <li>
            Create the event: name, venue, city, start and end time, and capacity. Check the times twice, because they
            cannot be changed once the event is on chain.
          </li>
          <li>If a sponsor is paying for your event, send them the event link so they can approve it.</li>
          <li>
            On the device you will use at the door, open the door screen once. It creates a door key in that browser
            and asks you to authorize it with one wallet signature. Bring the same device and browser on the day.
          </li>
          <li>Set the door device&apos;s clock to automatic. A clock that is far off makes codes look expired.</li>
        </ol>

        <h2>At the venue</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Minute</th>
              <th scope="col">What to do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>0 to 2</td>
              <td>Plug in the door device, connect it, open the door screen and check that the code changes.</td>
            </tr>
            <tr>
              <td>2 to 4</td>
              <td>Put the screen at the entrance at chest height, facing people as they walk in, away from windows.</td>
            </tr>
            <tr>
              <td>4 to 6</td>
              <td>Tape up the posters, one at the entrance and one beside the screen.</td>
            </tr>
            <tr>
              <td>6 to 8</td>
              <td>Have a helper who is really attending check in with their own phone. The live count goes to 1.</td>
            </tr>
            <tr>
              <td>8 to 10</td>
              <td>Walk your door helper through the script and the fixes below.</td>
            </tr>
          </tbody>
        </table>
        <p>Every check-in is real and on chain, so only test with someone who is actually at the event.</p>

        <h2>What to say to the room</h2>
        <p>
          Something like this, in your own words: &ldquo;On the screen by the door there is a code. Point your phone
          camera at it, tap the link, then tap check in. You do not need an app or a wallet, and it costs you nothing.
          In a few seconds you get a stamp in your passport, which is your proof that you were here. The code changes
          every fifteen seconds, so a photo of it will not work for friends who are not here.&rdquo;
        </p>

        <h2>Common fixes</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Problem</th>
              <th scope="col">Fix</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The camera does not react</td>
              <td>Hold the phone an arm&apos;s length away, turn the screen brightness up and tilt it away from glare.</td>
            </tr>
            <tr>
              <td>The link opened inside Instagram or WhatsApp</td>
              <td>Open it in Chrome or Safari. The pass lives in the browser, so use the same one every time.</td>
            </tr>
            <tr>
              <td>Everyone sees an expired code</td>
              <td>The door device&apos;s clock is wrong or the internet is slow. Set the clock to automatic and reload.</td>
            </tr>
            <tr>
              <td>The event is full</td>
              <td>Raise the capacity in the console.</td>
            </tr>
            <tr>
              <td>A long queue at the door</td>
              <td>Open a second door screen on another device. Each device authorizes its own door key.</td>
            </tr>
            <tr>
              <td>No internet at the venue</td>
              <td>Use a phone hotspot, or switch to door scans you, which queues scans until the device is back online.</td>
            </tr>
          </tbody>
        </table>

        <h2>Rules that are never broken</h2>
        <ul>
          <li>Real people at real events only. Never check in passes you control, and never script check-ins.</li>
          <li>Never share the door screen outside the room.</li>
          <li>Never ask anyone for a seed phrase or private key. Showmark never needs one.</li>
        </ul>
        <p>
          These rules protect you, your sponsor and every attendee, and anyone can read the chain to check them.
        </p>
      </Prose>
      <DocPager current="organizers" />
    </>
  );
}
