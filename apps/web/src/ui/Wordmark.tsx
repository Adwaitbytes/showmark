import { cn } from "./cn";

/** The Showmark seal: a small round stamp with a serif S, struck in vermilion. */
export function ShowmarkSeal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={cn("text-vermilion", className)}>
      <circle cx="16" cy="16" r="14.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="11.1" fill="none" stroke="currentColor" strokeWidth="0.9" />
      <text
        x="16"
        y="21.6"
        textAnchor="middle"
        fontSize="16.5"
        fill="currentColor"
        style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif" }}
      >
        S
      </text>
    </svg>
  );
}

/** Seal plus the name set in Instrument Serif. Size it with a text-* class on the parent. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display leading-none text-ink", className)}>
      <ShowmarkSeal className="size-[1.15em] shrink-0" />
      <span className="translate-y-[0.03em] tracking-[-0.01em]">Showmark</span>
    </span>
  );
}
