import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { Container } from "@/ui/Container";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { Wordmark } from "@/ui/Wordmark";
import { HeaderLinks, TabBar, type AttendeeSection } from "./AttendeeNav";
import { LanguageToggle } from "./LanguageToggle";

export interface AttendeeShellProps {
  current: AttendeeSection;
  /** The phone tab bar. Off on the check-in screen, where the stamp is the only thing that matters. */
  tabs?: boolean;
  children: ReactNode;
}

/**
 * Header and main landmark for the attendee app. Lighter than the public site header on purpose:
 * the check-in route has a 170 kB JavaScript budget, and someone at a door needs the language
 * switch, not the site menu. Renders the one <main id="main"> the skip link targets.
 */
export function AttendeeShell({ current, tabs = true, children }: AttendeeShellProps) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-paper grain pt-[env(safe-area-inset-top)] [view-transition-name:site-header]">
        <Container className="flex h-14 items-center justify-between gap-3 sm:h-16">
          {/* No prefetch from the door: the home page's code would spend a stranger's mobile data mid check-in. */}
          <Link href="/" prefetch={tabs} className="-ml-1 inline-flex min-h-11 items-center rounded-doc px-1 text-[1.5rem]">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <HeaderLinks current={current} />
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </Container>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "flex-1 focus:outline-none",
          tabs ? "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-16" : "pb-[calc(2.5rem+env(safe-area-inset-bottom))]",
        )}
      >
        {children}
      </main>
      {tabs ? <TabBar current={current} /> : null}
    </>
  );
}
