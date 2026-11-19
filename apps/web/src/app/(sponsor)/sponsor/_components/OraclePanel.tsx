"use client";

import { oraclePriceToNumber } from "@/lib/sponsor/math";
import type { OraclePrice, Read } from "@/lib/sponsor/use-chain";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatDate, formatTime } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";

/** Phase 0: the vault's limit is 48 hours. The live value from the vault wins when it can be read. */
export const DEFAULT_MAX_ORACLE_AGE = 48 * 60 * 60;

export function describeAge(seconds: number): string {
  if (seconds < 90) return "less than 2 minutes ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(seconds / 3600);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

export function OraclePanel({
  oracle,
  now,
  maxAge,
  onRetry,
}: {
  oracle: Read<OraclePrice>;
  now: number;
  maxAge: number;
  onRetry: () => void;
}) {
  const limitHours = Math.round(maxAge / 3600);
  if (oracle.status === "loading") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-doc bg-paper-deep px-4 py-3.5">
        <span className="sr-only">Reading the QIE price from the oracle</span>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3.5 w-64" />
      </div>
    );
  }
  if (oracle.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-doc bg-paper-deep px-4 py-3.5 text-sm">
        <p className="font-medium text-ink">The QIE price could not be read from the oracle just now.</p>
        <p className="text-ink-soft">You can still create the campaign; the vault reads the price itself at each payout.</p>
        <Button variant="quiet" onClick={onRetry} leading={<RetryIcon className="size-4" />}>
          Read again
        </Button>
      </div>
    );
  }
  const { answer, decimals, updatedAt } = oracle.value;
  const age = Math.max(0, now - updatedAt);
  const stale = age > maxAge || answer <= 0n;
  const price = oraclePriceToNumber(answer, decimals);
  const iso = new Date(updatedAt * 1000).toISOString();
  return (
    <div className="flex flex-col gap-2 rounded-doc bg-paper-deep px-4 py-3.5">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-lg text-ink">1 QIE = ${price.toFixed(4)}</span>
        <span className={cn("text-sm", stale ? "font-medium text-vermilion-ink" : "text-ink-soft")}>
          updated {describeAge(age)}, {formatDate(iso)} {formatTime(iso)}
          {stale ? `, older than the vault's ${limitHours} hour limit` : null}
        </span>
      </p>
      <p className="text-sm text-ink-soft">
        QIE updates this price every few hours and it can go up to two days without an update. If it is older than{" "}
        {limitHours} hours when someone checks in, their payout waits for the next update and is then paid at that
        fresh price. A stale price delays a payout; it never pays the wrong amount.
      </p>
    </div>
  );
}
