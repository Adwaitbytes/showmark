import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * A ledger: labelled figures joined by dotted leaders, as on a receipt. Use it for any list of
 * numbers a person compares (payout splits, report totals, traction). Figures are right aligned
 * and tabular.
 */
export function Ledger({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <dl aria-label={label} className={cn("flex flex-col", className)}>
      {children}
    </dl>
  );
}

export interface LedgerRowProps {
  label: ReactNode;
  value: ReactNode;
  /** A short note under the label: where the number comes from, or what it excludes. */
  note?: ReactNode;
  /** Emphasise a total. */
  total?: boolean;
  className?: string;
}

export function LedgerRow({ label, value, note, total = false, className }: LedgerRowProps) {
  // A <dl> group must be one <div> holding only <dt> and <dd>, so the dotted leader lives inside the
  // <dt> and the note is a second <dd>. Screen readers keep the term and value paired.
  return (
    <div className={cn("flex flex-wrap items-baseline py-2.5", total && "mt-1 border-t border-ink pt-3.5", className)}>
      <dt className={cn("flex min-w-0 flex-1 items-baseline gap-3 text-base text-ink-soft", total && "font-medium text-ink")}>
        <span className="min-w-0">{label}</span>
        <span aria-hidden="true" className="leader" />
      </dt>
      <dd
        className={cn(
          "shrink-0 pl-3 text-right font-mono text-base whitespace-nowrap text-ink",
          total && "text-md font-medium",
        )}
      >
        {value}
      </dd>
      {note ? <dd className="mt-0.5 basis-full text-sm text-ink-faint">{note}</dd> : null}
    </div>
  );
}
