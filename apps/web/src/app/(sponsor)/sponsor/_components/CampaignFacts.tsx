import type { CampaignSummary } from "@/lib/api/types";
import { formatUnits } from "viem";
import { splitPayout } from "@/lib/sponsor/math";
import type { OnChainCampaign } from "@/lib/sponsor/use-chain";
import { basisPointsToPercent, formatCount, formatDate, formatTime, formatUsd } from "@/ui/format";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { amountText, perPresenceText, PROOF_MODE_COPY } from "./campaign";

function when(seconds: number): string {
  const iso = new Date(seconds * 1000).toISOString();
  return `${formatDate(iso)}, ${formatTime(iso)}`;
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
      <LedgerRow label="Per verified person" value={perPresenceText(c)} />
      <LedgerRow
        label="Split"
        value={`${each(split.toAttendee)} / ${each(split.toOrganizer)}`}
        note={`Attendee ${basisPointsToPercent(c.attendeeShareBps)} and organizer the rest, after a ${basisPointsToPercent(c.feeBps)} protocol fee fixed at creation`}
      />
      <LedgerRow label="Proof required" value={PROOF_MODE_COPY[c.minProofMode].title} />
      <LedgerRow label="QIE ID required" value={c.requireQieId ? "Yes" : "No"} />
      <LedgerRow label="Pays from" value={when(startsAt)} />
      <LedgerRow label="Pays until" value={when(endsAt)} note={chain && chain.endsAt < Math.floor(Date.parse(c.endsAt) / 1000) ? "Closed early by the sponsor" : undefined} />
      {chain ? (
        <>
          <LedgerRow label="Cap per event" value={chain.maxPerEvent === 0 ? "None" : `${formatCount(chain.maxPerEvent)} people`} />
          <LedgerRow label="Cap in total" value={chain.maxTotal === 0 ? "None" : `${formatCount(chain.maxTotal)} people`} />
          <LedgerRow
            label="Bonded organizers"
            value={chain.openToBonded ? `Bond of ${formatUnits(chain.minBond, 18)} QIE or more` : "Approved events only"}
          />
        </>
      ) : null}
    </Ledger>
  );
}
