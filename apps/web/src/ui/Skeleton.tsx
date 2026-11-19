import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Loading placeholders in paper-deep with a slow ink pulse (still under reduced motion).
 * Wrap a group in <LoadingRegion> so assistive tech hears one "Loading ..." message.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block rounded-doc bg-paper-deep animate-ink-wait", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}

/** A blank stamp ring, for places where a stamp will land. */
export function SkeletonStamp({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block aspect-square rounded-pill border-2 border-dashed border-rule/60 animate-ink-wait",
        className,
      )}
    />
  );
}

export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
