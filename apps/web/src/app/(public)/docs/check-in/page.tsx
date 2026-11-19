import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/ui/Prose";
import { DocPager } from "../DocPager";

export const metadata: Metadata = {
  title: "How check-in works",
  description: "What happens between scanning the door code and the stamp landing, and the two proof modes.",
};

export default function CheckInDoc() {
  return (
    <>
      <Prose>
        <h1>How check-in works</h1>
        <p className="lead">
          From the moment a phone camera sees the door code to the stamp landing takes a few seconds and one tap. The
          attendee never needs a wallet, an app store or any QIE for gas.
        </p>

        <h2>Scan to stamp, step by step</h2>
        <ol>
          <li>
            The door screen shows a code that is a link: <code>/c/&#123;event&#125;.&#123;time&#125;.&#123;door signature&#125;</code>.
            The door key signs it again every 15 seconds.
          </li>
          <li>
            The phone camera opens that link in the browser. On a first visit, the app creates a guest pass: a key
            kept in that browser which can sign check-ins and nothing else. It never holds money.
          </li>
          <li>
            The attendee taps Check in. The pass signs <code>CheckIn(eventId, attendee)</code> with EIP-712, bound to
            QIE&apos;s chain id and the registry address.
          </li>
          <li>
            Our relayer simulates the call first, then submits it with both signatures and pays the gas. A call that
            would fail costs nothing and returns a plain explanation instead.
          </li>
          <li>
            The registry checks that the door key was authorized for this event by its organizer and is still valid,
            that both signatures are right, that the code is fresh, that the event has room, and that this pass has
            not checked in before. It then records the presence, emits <code>CheckedIn</code> and mints the stamp.
          </li>
          <li>
            Right behind it, in a separate transaction, the relayer asks the vault to settle every campaign that pays
            for this event. Usually both land in the same block.
          </li>
        </ol>
        <p>
          Recording presence and paying for it are separate on purpose. A campaign that has run dry, a stale price or a
          paused vault can delay a payout, but it can never stop a door.
        </p>

        <h2>The two proof modes</h2>
        <p>Every check-in records how it was proven. A sponsor chooses the weakest mode a campaign will pay for.</p>
        <table>
          <thead>
            <tr>
              <th scope="col">Mode</th>
              <th scope="col">Who scans whom</th>
              <th scope="col">What it proves</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1. Rotating door code</td>
              <td>The attendee scans the door screen.</td>
              <td>The phone saw a code signed seconds ago by a key the organizer authorized for this event.</td>
            </tr>
            <tr>
              <td>2. Door scans you</td>
              <td>Door staff scan a code on the attendee&apos;s phone.</td>
              <td>The door signed for this one attendee. Someone outside the room cannot get one.</td>
            </tr>
          </tbody>
        </table>

        <h3>Rotating door code</h3>
        <p>
          The door signs <code>DoorPass(eventId, issuedAt)</code>. The contract accepts it only when{" "}
          <code>issuedAt</code> is no more than 30 seconds ahead of block time and no older than the event&apos;s
          maximum pass age, which the organizer sets between 30 and 600 seconds. A photo of yesterday&apos;s code is
          worthless. What it cannot stop is someone in the room streaming the screen to a friend outside within that
          window, so organizers never show the door screen online.
        </p>

        <h3>Door scans you</h3>
        <p>
          The attendee shows a code from their passport, staff scan it, and the door key signs{" "}
          <code>DoorAttest(eventId, attendee, attestedAt)</code>. The attestation is bound to that attendee, so it is
          the strongest proof. It also works without a connection: the door device queues scans and submits them later,
          up to three days after the event ends.
        </p>

        <h2>When check-in is open</h2>
        <p>
          From one hour before the event&apos;s start to one hour after its end, by block time for the rotating code
          and by the attestation time for door scans. Capacity is enforced on chain, and the organizer can raise it at
          any time.
        </p>

        <h2>What people see when it does not work</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">What happened</th>
              <th scope="col">What to do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Already checked in</td>
              <td>Nothing. The stamp is already in the passport.</td>
            </tr>
            <tr>
              <td>The code has expired</td>
              <td>Scan again. The newest code is already on the screen.</td>
            </tr>
            <tr>
              <td>Check-in has not opened, or has closed</td>
              <td>It opens one hour before the start and closes one hour after the end.</td>
            </tr>
            <tr>
              <td>The event is full</td>
              <td>Ask the organizer, who can raise the capacity.</td>
            </tr>
            <tr>
              <td>The door is not authorized</td>
              <td>The organizer authorizes the door device again with one wallet signature.</td>
            </tr>
          </tbody>
        </table>

        <h2>Streaks</h2>
        <p>
          Events can belong to a series, like a weekly meetup. Coming to the next one in a series adds to a streak,
          which the registry tracks per pass, and sponsors can reward it.
        </p>

        <h2>Getting paid</h2>
        <p>
          Rewards build up against the pass inside the vault. To withdraw, the attendee connects QIE Wallet and links
          it to the pass, which takes a signature from both. A link is one to one and permanent, so one person cannot
          farm a campaign that requires a QIE ID through many passes. Stamps move to the linked wallet at the same time.
        </p>
        <p>
          See every stamp a pass or wallet holds on its public passport page, for example{" "}
          <Link href="/me">your own passport</Link>.
        </p>
      </Prose>
      <DocPager current="check-in" />
    </>
  );
}
