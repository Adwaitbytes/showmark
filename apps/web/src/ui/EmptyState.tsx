import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  /** What is empty, said plainly: "No check-ins yet". */
  title: string;
  /** Why, and what happens next. One or two sentences. */
  children?: ReactNode;
  /** The next action, usually a <Button>. */
  action?: ReactNode;
  /** Heading level so the empty state fits the page outline. */
  as?: "h1" | "h2" | "h3";
  align?: "start" | "center";
  className?: string;
}

/** The blank ring where a stamp will be. Used by empty states. */
export function BlankStampMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-14 text-rule", className)} fill="none">
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" />
      <circle cx="32" cy="32" r="21" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" />
    </svg>
  );
}

/** An empty screen is an invitation to act: say what is missing and offer the next step. */
export function EmptyState({ title, children, action, as: Heading = "h2", align = "start", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 py-2",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      <BlankStampMark />
      <div className={cn("flex max-w-prose flex-col gap-2", align === "center" && "items-center")}>
        <Heading className="font-display text-xl text-ink">{title}</Heading>
        {children ? <div className="text-base text-ink-soft">{children}</div> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
