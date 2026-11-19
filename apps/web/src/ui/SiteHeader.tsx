import Link from "next/link";
import { PASSPORT_NAV, PRIMARY_NAV, ROLE_NAV, type NavKey } from "@/lib/copy/site";
import { cn } from "./cn";
import { Container } from "./Container";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex min-h-11 items-center px-1 text-base transition-colors duration-150",
        "after:absolute after:inset-x-1 after:bottom-2 after:h-px after:origin-left after:bg-current after:transition-transform after:duration-200",
        active ? "text-ink after:scale-x-100" : "text-ink-soft after:scale-x-0 hover:text-ink hover:after:scale-x-100",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * The site header. Server-rendered; only the phone menu and theme switch hydrate. Pass the
 * current section so it is marked for sighted and screen reader users alike. It keeps its
 * place during view transitions (view-transition-name: site-header).
 */
export function SiteHeader({ current = "none" }: { current?: NavKey }) {
  return (
    <header className="sticky top-0 z-40 border-b border-rule-soft grain bg-paper [view-transition-name:site-header]">
      <Container className="relative flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="-ml-1 inline-flex min-h-11 items-center rounded-doc px-1 text-[1.625rem]"
         
        >
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-5 md:flex lg:gap-7">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} active={item.key === current} />
          ))}
          <span aria-hidden="true" className="hidden h-5 w-px bg-rule-soft lg:block" />
          {ROLE_NAV.map((item) => (
            <span key={item.href} className="hidden lg:contents">
              <NavLink href={item.href} label={item.label} active={item.key === current} />
            </span>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Link
            href={PASSPORT_NAV.href}
            aria-current={current === "passport" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-doc bg-ink px-4 text-base font-medium text-paper shadow-[inset_0_-2px_0_rgb(0_0_0/0.22)] transition-colors hover:bg-ink-soft"
          >
            {PASSPORT_NAV.label}
          </Link>
        </div>

        <MobileNav items={[...PRIMARY_NAV, ...ROLE_NAV, PASSPORT_NAV]} current={current} />
      </Container>
    </header>
  );
}
