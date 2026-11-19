import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/ui/Prose";
import { DocPager } from "../DocPager";

export const metadata: Metadata = {
  title: "Sponsor guide",
  description: "Fund a Showmark campaign, choose which events count, and pay only for verified people.",
};

export default function SponsorGuide() {
  return (
    <>
      <Prose>
        <h1>Sponsor guide</h1>
        <p className="lead">
          You put a budget in escrow and set the price of one verified person. Showmark pays that price only when
          someone checks in at an event you chose, splits it between the organizer and the attendee, and returns
          everything not earned when the campaign ends.
        </p>

        <h2>Set up a campaign</h2>
        <p>
          Open the <Link href="/sponsor">sponsor console</Link>, sign in with QIE Wallet and choose:
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">What it means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Token</td>
              <td>Native QIE, or QUSDC, the chain&apos;s dollar stablecoin.</td>
            </tr>
            <tr>
              <td>Price per person</td>
              <td>
                An amount of the token, or a dollar amount paid in QIE at the QIE/USD oracle price when each person
                checks in.
              </td>
            </tr>
            <tr>
              <td>Attendee share</td>
              <td>How much of each payout goes to the attendee. The rest goes to the organizer.</td>
            </tr>
            <tr>
              <td>Proof required</td>
              <td>
                The rotating door code, or door scans you, which binds each check-in to one person. See{" "}
                <Link href="/docs/check-in">proof modes</Link>.
              </td>
            </tr>
            <tr>
              <td>QIE ID required</td>
              <td>Pay only people whose linked wallet holds a .qie name. They can link after the event and still be paid.</td>
            </tr>
            <tr>
              <td>Dates and caps</td>
              <td>When presence counts, and optional limits per event and in total.</td>
            </tr>
            <tr>
              <td>Who can be paid</td>
              <td>Events you approve one by one, or any organizer who has staked at least a bond you set.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Your deposit goes into the vault in the same transaction that creates the campaign. Anyone can top a campaign
          up later, and a Safe treasury can fund it directly.
        </p>

        <h2>How one payout is worked out</h2>
        <p>For every verified person at an eligible event, the vault computes, in this order:</p>
        <pre>
          {`gross        = price of one person, in the token
fee          = gross * fee rate
               (the rate is fixed when the campaign is created, at most 5%)
net          = gross - fee
to attendee  = net * attendee share
to organizer = net - to attendee`}
        </pre>
        <p>
          For example, at 2 QUSDC per person with a 2.5% fee and 60% to the attendee, each check-in moves 1.17 QUSDC
          to the attendee, 0.78 QUSDC to the organizer and 0.05 QUSDC in fees. If 140 people come from a 500 QUSDC
          budget, 280 QUSDC is spent and 220 QUSDC comes back to you.
        </p>

        <h2>When a payout waits</h2>
        <p>Presence is always recorded. A payout is skipped or deferred, with the reason logged on chain, when:</p>
        <ul>
          <li>the check-in used a weaker proof than the campaign requires,</li>
          <li>it happened outside the campaign dates,</li>
          <li>the event is not approved and its organizer is not bonded enough,</li>
          <li>a per-event or total cap is reached, or the budget has run out,</li>
          <li>the campaign needs a QIE ID and the attendee has not linked a wallet holding one yet,</li>
          <li>or, for dollar-priced campaigns, the oracle price is stale. It is paid once the price is fresh again.</li>
        </ul>
        <p>Deferred payouts can be retried by anyone until three days after the campaign ends.</p>

        <h2>Ending and refunds</h2>
        <p>
          You can close a campaign early at any time. Three days after it ends, you can take back everything left in
          it. That works even if the protocol is paused, because pausing never blocks refunds or withdrawals.
        </p>

        <h2>What you can show your team</h2>
        <p>
          The console lists every settlement with its transaction on the explorer, and exports a report as CSV. Each
          line is a person who was verifiably at the door, not an estimate.
        </p>
        <p>
          Before you fund anything, read the <Link href="/docs/security">security model</Link>. It says plainly where the
          guarantees stop, including what the rotating door code cannot prove.
        </p>
      </Prose>
      <DocPager current="sponsors" />
    </>
  );
}
