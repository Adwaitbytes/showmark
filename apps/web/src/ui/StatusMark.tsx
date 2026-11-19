import { cn } from "./cn";

export type StatusTone = "live" | "scheduled" | "ended" | "attention" | "neutral";

const tones: Record<StatusTone, { ring: string; dot: string }> = {
  live: { ring: "text-ledger-green", dot: "bg-ledger-green" },
  scheduled: { ring: "text-stamp-blue", dot: "bg-stamp-blue" },
  ended: { ring: "text-ink-soft", dot: "bg-ink-soft" },
  attention: { ring: "text-vermilion-ink", dot: "bg-vermilion" },
  neutral: { ring: "text-ink", dot: "bg-ink" },
};

/**
 * A compact status, the one place pills are used: "Live", "Ended", "Refundable". The word
 * carries the meaning; colour only supports it. Static by design, so it never pulses.
 */
export function StatusMark({ tone, children, className }: { tone: StatusTone; children: string; className?: string }) {
  const style = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-pill px-3 text-sm font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]",
        style.ring,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-pill", style.dot)} />
      <span className="text-ink">{children}</span>
    </span>
  );
}
