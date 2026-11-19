import type { Metadata } from "next";
import { SITE } from "@/lib/copy/site";
import { Prose } from "@/ui/Prose";
import { DocPager } from "../DocPager";

export const metadata: Metadata = {
  title: "Security model",
  description: "What the Showmark contracts enforce, what they cannot prove, and who holds which powers.",
};

export default function SecurityDoc() {
  return (
    <>
      <Prose>
        <h1>Security model</h1>
        <p className="lead">
          Sponsors trust Showmark with money and attendees trust it with their proof of being somewhere. This page says
          exactly what the contracts guarantee, where those guarantees stop, and who can do what.
        </p>

        <h2>What the contracts enforce</h2>
        <p>Each of these is a Foundry test in the contracts package, including fuzz and invariant tests.</p>
        <ol>
          <li>Presence is recorded at most once per event and attendee.</li>
          <li>
            A check-in never fails because of a campaign or payout problem. The registry does not depend on the vault.
          </li>
          <li>For every token, the vault always holds at least what it owes sponsors and people combined.</li>
          <li>
            A sponsor can always recover unspent funds three days after a campaign ends, even when the protocol is
            paused.
          </li>
          <li>Only a door key the event&apos;s organizer authorized, inside its validity window, can vouch for a check-in.</li>
          <li>
            Every signature is EIP-712, bound to the chain id and the contract address, so nothing replays across
            events, contracts or chains.
          </li>
          <li>The protocol fee is capped at 5% in the code and fixed for each campaign when it is created.</li>
          <li>
            State changes happen before any transfer, everyone is paid by pulling their balance, and everything that
            moves funds is guarded against reentrancy.
          </li>
          <li>There are no proxies. Pause stops new campaigns, check-ins and settlement, and never blocks refunds or withdrawals.</li>
          <li>A stale or non-positive oracle price defers a dollar-priced payout instead of paying the wrong amount.</li>
        </ol>

        <h2>What presence can and cannot prove</h2>
        <h3>Rotating door code</h3>
        <p>
          Freshness is checked against block time, so an old screenshot is useless. It does not stop someone inside
          the venue from streaming the door screen to a friend outside within the code&apos;s short window. That is why
          sponsors can require the stronger mode.
        </p>
        <h3>Door scans you</h3>
        <p>
          The door key signs for one attendee after staff scan that attendee&apos;s code. Nobody outside the room can
          get one without being scanned at the door.
        </p>
        <h3>Soft signals</h3>
        <p>
          Rate limits per IP address and per pass, device limits and anomaly flags in sponsor reports help, and they
          are labeled as soft everywhere. They are not proof.
        </p>
        <h3>Fake people</h3>
        <p>
          Free QIE ID names are a weak filter on their own. The main defense is presence itself: every pass needs a
          door signature at a real place and time, and capacity is capped per event. Wallet links are one to one, so
          a single QIE ID cannot collect a QIE ID gated campaign through many passes.
        </p>
        <h3>Dishonest organizers</h3>
        <p>
          An organizer controls the door, so a dishonest one could check in passes they hold. Sponsors limit that by
          approving events one by one or by requiring a bond, which the arbitrator can slash after a sponsor
          challenge. In this version the arbitrator is the protocol Safe. That is centralized, and we say so.
        </p>

        <h2>Off-chain parts</h2>
        <ul>
          <li>
            <strong>Relayer.</strong> Sends calls only to the registry and the vault, simulates every call first,
            rate-limits per address and per pass, and raises an alert when its gas runs low.
          </li>
          <li>
            <strong>Guest passes.</strong> The key lives in the browser. A pass never holds money: rewards stay in the
            vault until withdrawn to the linked wallet. Losing a pass stops new check-ins from it, not past stamps.
          </li>
          <li>
            <strong>Sessions.</strong> Organizers and sponsors sign in with a wallet signature and get a short-lived
            cookie that cannot be read by scripts.
          </li>
          <li>
            <strong>Secrets</strong> live only in environment variables, and every push is scanned for leaked keys.
          </li>
        </ul>

        <h2>Who holds which power</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Power</th>
              <th scope="col">Held by</th>
              <th scope="col">Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pause the registry and vault</td>
              <td>Protocol Safe</td>
              <td>Cannot block refunds or withdrawals</td>
            </tr>
            <tr>
              <td>Set the protocol fee</td>
              <td>Protocol Safe</td>
              <td>At most 5%, new campaigns only</td>
            </tr>
            <tr>
              <td>Change the stamp image address</td>
              <td>Protocol Safe</td>
              <td>Cosmetic only</td>
            </tr>
            <tr>
              <td>Resolve bond challenges</td>
              <td>Protocol Safe</td>
              <td>Can slash only an organizer&apos;s bond</td>
            </tr>
            <tr>
              <td>Relay transactions</td>
              <td>Showmark server</td>
              <td>Every call must also pass the on-chain checks; it holds gas money only</td>
            </tr>
          </tbody>
        </table>

        <h2>Independent review</h2>
        <p>
          The contracts are reviewed by a reviewer who did not write them, against the invariants and threat model
          above. Every finding and its resolution is recorded in <code>docs/SECURITY.md</code> in the{" "}
          <a href={`${SITE.repoUrl}/blob/main/docs/SECURITY.md`} target="_blank" rel="noopener noreferrer">
            repository
          </a>{" "}
          before anything holds funds on mainnet.
        </p>
      </Prose>
      <DocPager current="security" />
    </>
  );
}
