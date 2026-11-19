import type { ReactNode } from "react";
import { cn } from "./cn";

export interface ErrorStateProps {
  /** What happened, in plain words: "We could not reach the QIE network". */
  title: string;
  /** What to do next. Never a raw revert string or stack trace. */
  children: ReactNode;
  /** The recovery action, usually a retry <Button>. */
  action?: ReactNode;
  /** A reference people can quote when they ask for help (an error digest). */
  reference?: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
}

/** A struck-through ring: the stamp that did not land. */
function VoidMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-14 text-vermilion-ink" fill="none">
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="2" strokeOpacity="0.55" strokeDasharray="4 5" />
      <path d="M14 50 50 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Every error says what happened and what to do next, and offers a way forward. */
export function ErrorState({ title, children, action, reference, as: Heading = "h2", className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-4 py-2", className)}>
      <VoidMark />
      <div className="flex max-w-prose flex-col gap-2">
        <Heading className="font-display text-xl text-ink">{title}</Heading>
        <div className="text-base text-ink-soft">{children}</div>
        {reference ? (
          <p className="text-sm text-ink-faint">
            Reference <span className="font-mono">{reference}</span>
          </p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-3 pt-1">{action}</div> : null}
    </div>
  );
}
