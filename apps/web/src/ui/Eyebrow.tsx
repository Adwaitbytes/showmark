import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The small label above a heading or document ("Admit one judge", "Showmark passport"). Sentence
 * case in ink-soft, never tracked capitals and never vermilion (D-041): vermilion is kept for the one
 * primary action and the check-in stamp.
 */
export function Eyebrow({ children, as: Element = "p", className }: { children: ReactNode; as?: "p" | "span" | "div"; className?: string }) {
  return <Element className={cn("text-sm font-medium text-ink-soft", className)}>{children}</Element>;
}
