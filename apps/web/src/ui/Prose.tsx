import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Long-form reading: docs, guides, legal. Write plain semantic HTML inside (h1, p, h2, ul, pre,
 * table) and it is set in the Showmark type system with a comfortable measure.
 * Add className="lead" to the opening paragraph for the larger intro size.
 */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-[42rem] text-base leading-[1.7] text-ink-soft",
        "[&_h1]:font-display [&_h1]:text-4xl [&_h1]:leading-[1] [&_h1]:text-ink sm:[&_h1]:text-5xl",
        "[&_.lead]:mt-5 [&_.lead]:text-md [&_.lead]:leading-[1.55] [&_.lead]:text-ink-soft sm:[&_.lead]:text-lg sm:[&_.lead]:leading-[1.5]",
        "[&_h2]:mt-14 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-ink",
        "[&_h3]:mt-9 [&_h3]:mb-2 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:text-ink",
        "[&_p]:mt-4 [&_strong]:font-medium [&_strong]:text-ink",
        "[&_ul]:mt-4 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_ul]:marker:text-ink-faint",
        "[&_ol]:mt-4 [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-5 [&_ol]:marker:font-mono [&_ol]:marker:text-sm [&_ol]:marker:text-ink-faint",
        "[&_a]:text-stamp-blue [&_a]:underline [&_a]:decoration-stamp-blue/35 [&_a]:underline-offset-4 hover:[&_a]:decoration-stamp-blue",
        "[&_:not(pre)>code]:rounded-doc [&_:not(pre)>code]:bg-paper-deep [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:text-ink",
        "[&_pre]:mt-5 [&_pre]:overflow-x-auto [&_pre]:rounded-doc [&_pre]:bg-paper-deep [&_pre]:px-5 [&_pre]:py-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-[1.65] [&_pre]:text-ink [&_pre]:shadow-[inset_0_0_0_1px_var(--rule-soft)]",
        "[&_table]:mt-5 [&_table]:w-full [&_table]:text-left [&_table]:text-sm",
        "[&_th]:border-b [&_th]:border-ink [&_th]:py-2.5 [&_th]:pr-4 [&_th]:font-medium [&_th]:text-ink",
        "[&_td]:border-b [&_td]:border-rule-soft [&_td]:py-2.5 [&_td]:pr-4 [&_td]:align-top sm:[&_td:first-child]:whitespace-nowrap",
        "[&_hr]:my-12 [&_hr]:border-rule-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}
