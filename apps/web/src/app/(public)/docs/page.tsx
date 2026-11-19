import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/copy/site";
import { Prose } from "@/ui/Prose";
import { DocPager } from "./DocPager";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Showmark works: escrowed sponsorship that pays per verified person at the door, on QIE.",
};

export default function DocsOverview() {
  return (
    <>
      <Prose>
        <h1>Showmark docs</h1>
        <p className="lead">
          Showmark is sponsorship that pays per person who actually shows up. A sponsor locks a budget in escrow on
          QIE, an organizer runs a real event with a signed door code, and every verified check-in pays the organizer
          and the attendee from that budget. Whatever is not earned goes back to the sponsor.
        </p>

        <h2>The three roles</h2>
        <ul>
          <li>
            <strong>Sponsors</strong> fund a campaign in QIE or QUSDC, set the price of one verified person and how it
            splits between organizer and attendee, and choose which events count. Read the{" "}
            <Link href="/docs/sponsors">sponsor guide</Link>.
          </li>
          <li>
            <strong>Organizers</strong> create the event on chain and run a door screen that shows a code signed again
            every 15 seconds. Read the <Link href="/docs/organizers">organizer playbook</Link>.
          </li>
          <li>
            <strong>Attendees</strong> scan the door code with a phone camera and tap once. They need no wallet and no
            QIE to start, and they get a stamp in their passport. Read{" "}
            <Link href="/docs/check-in">how check-in works</Link>.
          </li>
        </ul>

        <h2>What lives on chain</h2>
        <p>
          Four small contracts on QIE hold everything that matters. None of them can be upgraded, and each is owned by
          a Safe multisig.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>ShowmarkRegistry</code>
              </td>
              <td>Events, door keys, check-ins, streaks and the one-time link from a guest pass to a wallet.</td>
            </tr>
            <tr>
              <td>
                <code>PresenceStamp</code>
              </td>
              <td>The stamps: one non-transferable token per event, so they show up in wallets and on the explorer.</td>
            </tr>
            <tr>
              <td>
                <code>CampaignVault</code>
              </td>
              <td>Sponsor escrow, settlement per presence, the split, the capped fee, refunds and withdrawals.</td>
            </tr>
            <tr>
              <td>
                <code>OrganizerBond</code>
              </td>
              <td>Organizers can stake QIE so sponsors can fund them without approving each event.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Event names and venues are stored in contract events, not in a private database, so every public page can be
          rebuilt from the chain alone. The app reads them through an indexer, and every number on the{" "}
          <Link href="/traction">traction page</Link> links back to a transaction.
        </p>

        <h2>Where to go next</h2>
        <ul>
          <li>
            Building on Showmark: the <Link href="/docs/sdk">SDK quickstart</Link> and the{" "}
            <a href={SITE.repoUrl} target="_blank" rel="noopener noreferrer">
              source on GitHub
            </a>
            .
          </li>
          <li>
            Deciding whether to trust it: the <Link href="/docs/security">security model</Link> says exactly what the
            contracts enforce and what they cannot.
          </li>
        </ul>
      </Prose>
      <DocPager current="" />
    </>
  );
}
