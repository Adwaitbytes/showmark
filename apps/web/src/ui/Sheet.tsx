import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type SheetElement = "div" | "section" | "article" | "aside" | "header" | "li" | "figure";

export interface SheetProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  as?: SheetElement;
  /**
   * sheet: a document lying on the desk (raised, grain, soft shadow). Default.
   * inset: a slip printed into the page (paper-deep, no shadow), for secondary panels.
   */
  tone?: "sheet" | "inset";
  /** Cut the top and/or bottom edge like a stamp or ticket stub. */
  edge?: "plain" | "stub-bottom" | "stub-top" | "stub-both";
  className?: string;
  children: ReactNode;
}

const stubMask: Record<Exclude<NonNullable<SheetProps["edge"]>, "plain">, string> = {
  "stub-bottom":
    "[mask:radial-gradient(circle_at_6px_100%,transparent_3.5px,#000_4px)_bottom_left/12px_8px_repeat-x,linear-gradient(#000,#000)_top/100%_calc(100%-8px)_no-repeat]",
  "stub-top":
    "[mask:radial-gradient(circle_at_6px_0,transparent_3.5px,#000_4px)_top_left/12px_8px_repeat-x,linear-gradient(#000,#000)_bottom/100%_calc(100%-8px)_no-repeat]",
  "stub-both":
    "[mask:radial-gradient(circle_at_6px_0,transparent_3.5px,#000_4px)_top_left/12px_8px_repeat-x,radial-gradient(circle_at_6px_100%,transparent_3.5px,#000_4px)_bottom_left/12px_8px_repeat-x,linear-gradient(#000,#000)_center/100%_calc(100%-16px)_no-repeat]",
};

/**
 * The document surface every screen is built from. Square-ish corners (2 px), a faint grain and
 * a shadow that reads as paper on a desk, not a floating card. Stub edges are real cut-outs
 * (CSS masks), so their shadow comes from a drop-shadow on a wrapper.
 */
export function Sheet({ as: Element = "div", tone = "sheet", edge = "plain", className, children, ...rest }: SheetProps) {
  const surface = tone === "sheet" ? "bg-sheet grain" : "bg-paper-deep";
  if (edge === "plain") {
    return (
      <Element
        className={cn("relative rounded-doc text-ink", surface, tone === "sheet" && "shadow-sheet", className)}
        {...rest}
      >
        {children}
      </Element>
    );
  }
  return (
    <div className="[filter:drop-shadow(0_1px_1px_rgb(var(--shadow-color)/0.08))_drop-shadow(0_10px_14px_rgb(var(--shadow-color)/0.14))]">
      <Element className={cn("relative text-ink", surface, stubMask[edge], className)} {...rest}>
        {children}
      </Element>
    </div>
  );
}

export function SheetSection({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 py-5 sm:px-8 sm:py-7", className)} {...rest}>
      {children}
    </div>
  );
}
