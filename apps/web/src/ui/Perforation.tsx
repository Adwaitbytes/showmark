import { cn } from "./cn";

export interface PerforationProps {
  orientation?: "horizontal" | "vertical";
  /** Half-circle bites where the tear line meets the sheet edge. */
  notches?: boolean;
  className?: string;
}

/**
 * A tear line: a row of punched holes with a bite at each end, as on a ticket stub. The holes
 * show the surface beneath the sheet, which is the page (--paper) unless the parent sets
 * --perf-hole. Place it as a direct child of <Sheet> between two <SheetSection>s.
 */
export function Perforation({ orientation = "horizontal", notches = true, className }: PerforationProps) {
  const horizontal = orientation === "horizontal";
  const notch =
    "pointer-events-none absolute size-4 rounded-pill bg-[var(--perf-hole,var(--paper))] shadow-[inset_0_1px_2px_rgb(var(--shadow-color)/0.18)]";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn("relative shrink-0", horizontal ? "perf-x mx-4 h-2" : "perf-y my-4 w-2 self-stretch", className)}
    >
      {notches ? (
        horizontal ? (
          <>
            <span className={cn(notch, "top-1/2 -left-6 -translate-y-1/2")} />
            <span className={cn(notch, "top-1/2 -right-6 -translate-y-1/2")} />
          </>
        ) : (
          <>
            <span className={cn(notch, "-top-6 left-1/2 -translate-x-1/2")} />
            <span className={cn(notch, "-bottom-6 left-1/2 -translate-x-1/2")} />
          </>
        )
      ) : null}
    </div>
  );
}
