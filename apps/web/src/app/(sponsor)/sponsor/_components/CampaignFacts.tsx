import type { CampaignSummary } from "@/lib/api/types";
import { formatUnits } from "viem";
import { splitPayout } from "@/lib/sponsor/math";
import type { OnChainCampaign } from "@/lib/sponsor/use-chain";
import { basisPointsToPercent, formatCount, formatDate, formatTime, formatUsd } from "@/ui/format";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { amountText, PROOF_MODE_COPY } from "./campaign";

function when(seconds: number): string {
  const iso = new Date(seconds * 1000).toISOString();
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

function perPerson(c: CampaignSummary): string {
  return c.pricing === 1 ? `${formatUsd(Number(c.amountPerPresence) / 1e6)} in QIE` : amountText(c.amountPerPresence, c.tokenSymbol);
}

/** Words in a ledger read as words, not code: the ledger sets figures in mono. */
function Word({ children }: { children: React.ReactNode }) {
  return <span className="font-sans">{children}</span>;
}

/** The terms of a campaign as the vault holds them, in plain words. */
export function CampaignFacts({ c, chain }: { c: CampaignSummary; chain: OnChainCampaign | null }) {
  const gross = BigInt(c.amountPerPresence);
  const split = splitPayout(gross, c.feeBps, c.attendeeShareBps);
  const usd = c.pricing === 1;
  const each = (v: bigint) => (usd ? formatUsd(Number(v) / 1e6) : amountText(v, c.tokenSymbol));
  const startsAt = chain?.startsAt ?? Math.floor(Date.parse(c.startsAt) / 1000);
  const endsAt = chain?.endsAt ?? Math.floor(Date.parse(c.endsAt) / 1000);

  return (
    <Ledger label="Campaign terms">
      <LedgerRow label="Per person" value={perPerson(c)} note={c.pricing === 1 ? "Paid in QIE at the oracle price when each person checks in" : undefined} />
      <LedgerRow
        label="Attendee gets"
        value={each(split.toAttendee)}
        note={`${basisPointsToPercent(c.attendeeShareBps)} of what is left after the ${basisPointsToPercent(c.feeBps)} protocol fee`}
      />
      <LedgerRow label="Organizer gets" value={each(split.toOrganizer)} />
      <LedgerRow label="Proof" value={<Word>{PROOF_MODE_COPY[c.minProofMode].title}</Word>} note={PROOF_MODE_COPY[c.minProofMode].short} />
      <LedgerRow label="QIE ID needed" value={<Word>{c.requireQieId ? "Yes" : "No"}</Word>} />
      <LedgerRow label="From" value={when(startsAt)} />
      <LedgerRow label="Until" value={when(endsAt)} note={chain && chain.endsAt < Math.floor(Date.parse(c.endsAt) / 1000) ? "Closed early by the sponsor" : undefined} />
      {chain ? (
        <>
          <LedgerRow label="Per event cap" value={chain.maxPerEvent === 0 ? <Word>None</Word> : formatCount(chain.maxPerEvent)} />
          <LedgerRow label="Total cap" value={chain.maxTotal === 0 ? <Word>None</Word> : formatCount(chain.maxTotal)} />
          <LedgerRow
            label="Bonded organizers"
            value={<Word>{chain.openToBonded ? "Paid" : "Not paid"}</Word>}
            note={chain.openToBonded ? `Organizers with a bond of ${formatUnits(chain.minBond, 18)} QIE or more are paid without approval` : "Only events the sponsor approved are paid"}
          />
        </>
      ) : null}
    </Ledger>
  );
}
