import Link from "next/link";
import { connection } from "next/server";
import type { Traction } from "@/lib/api/types";
import { isDeployed } from "@/lib/chain/addresses";
import { activeChain } from "@/lib/chain/chains";
import { getTraction } from "@/server/queries";
import { BlankStampMark } from "@/ui/EmptyState";
import { formatCount, formatTime, formatTokenAmount, formatUsd } from "@/ui/format";
import { Notice } from "@/ui/Notice";
import { Skeleton } from "@/ui/Skeleton";
import { load } from "./load";

function settledSummary(traction: Traction): string {
  const parts = traction.settled
    .map((row) => {
      const total = (BigInt(row.teamFunded) + BigInt(row.external)).toString();
      return total === "0" ? null : `${formatTokenAmount(total, row.symbol)} ${row.symbol}`;
    })
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join(" and ") : "Nothing settled yet";
}

function Cell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-5 sm:px-6">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-2xl font-medium tracking-[-0.01em] text-ink">{value}</dd>
      <dd className="text-sm text-ink-faint">{note}</dd>
    </div>
  );
}

// Hairlines come from the 1 px grid gap showing the rule colour between opaque cells.
const frame = "grid grid-cols-2 gap-px bg-rule-soft lg:grid-cols-4 [&>*]:bg-sheet";

export function LiveStripSkeleton() {
  return (
    <div role="status" aria-busy="true" className={frame}>
      <span className="sr-only">Reading the live numbers from the chain</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2.5 px-5 py-5 sm:px-6" aria-hidden="true">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      ))}
    </div>
  );
}

/** Four numbers read from the indexer at request time. Never fixture data; empty when the chain is empty. */
export async function LiveStrip() {
  await connection();
  const result = await load(getTraction);

  if (!result.ok) {
    return (
      <div className="p-5 sm:p-6">
        <Notice tone="warning" title={result.message}>
          {result.action}
        </Notice>
      </div>
    );
  }

  const traction = result.data;
  if (traction.verifiedAttendees === 0) {
    return (
      <div className="flex flex-col items-start gap-4 px-5 py-6 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
        <BlankStampMark className="size-12 shrink-0" />
        <p className="max-w-2xl text-base text-ink-soft">
          {isDeployed()
            ? `Nothing has been stamped on ${activeChain.name} yet. These numbers count up from the first real check-in, straight from the chain.`
            : `The Showmark contracts are not live on ${activeChain.name} yet, so there is nothing to count. These numbers fill in from the first real check-in.`}
        </p>
      </div>
    );
  }

  const usd = traction.settledUsd.teamFunded + traction.settledUsd.external;
  return (
    <>
      <dl className={frame}>
        <Cell
          label="Verified attendees"
          value={formatCount(traction.verifiedAttendees)}
          note="Distinct passes with a recorded presence"
        />
        <Cell
          label="Events with check-ins"
          value={formatCount(traction.eventsWithCheckIns)}
          note={`Run by ${formatCount(traction.organizers)} organizers`}
        />
        <Cell label="Settled to people" value={usd > 0 ? formatUsd(usd) : "0"} note={settledSummary(traction)} />
        <Cell
          label="Showmark transactions"
          value={formatCount(traction.showmarkTransactions)}
          note={`On ${activeChain.name}`}
        />
      </dl>
      <p className="border-t border-rule-soft px-5 py-3 text-sm text-ink-faint sm:px-6">
        Read at {formatTime(traction.updatedAt)}.{" "}
        <Link href="/traction" className="text-ink-soft underline underline-offset-4 hover:text-ink">
          See every number and where it comes from
        </Link>
      </p>
    </>
  );
}
