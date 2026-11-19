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
  return (
    <div className={cn("py-2.5", total && "mt-1 border-t border-ink pt-3.5", className)}>
      <div className="flex items-baseline gap-3">
        <dt className={cn("text-base text-ink-soft", total && "font-medium text-ink")}>{label}</dt>
        <span aria-hidden="true" className="leader" />
        <dd className={cn("text-right font-mono text-base text-ink", total && "text-md font-medium")}>{value}</dd>
      </div>
      {note ? <p className="mt-0.5 text-sm text-ink-faint">{note}</p> : null}
    </div>
  );
}
