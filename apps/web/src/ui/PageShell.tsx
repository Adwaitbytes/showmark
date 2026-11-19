import type { ReactNode } from "react";
import type { NavKey } from "@/lib/copy/site";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export interface PageShellProps {
  /** Which header item to mark as current. */
  current?: NavKey;
  /** Drop the footer for focused task screens (check-in, door screen). */
  footer?: boolean;
  children: ReactNode;
}

/**
 * Header, main landmark and footer. The root layout's skip link targets #main, so every page
 * must render exactly one <main id="main">; PageShell does that for you.
 */
export function PageShell({ current = "none", footer = true, children }: PageShellProps) {
  return (
    <>
      <SiteHeader current={current} />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      {footer ? <SiteFooter /> : null}
    </>
  );
}
