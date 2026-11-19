"use client";

import Link from "next/link";
import { useLocale } from "@/lib/checkin/locale";
import { cn } from "@/ui/cn";
import { PassportIcon, ScanIcon } from "./icons";

export type AttendeeSection = "pass" | "scan" | "checkin";

function useItems() {
  const { t } = useLocale();
  return [
    { key: "pass", href: "/pass", label: t.nav.passport, Icon: PassportIcon },
    { key: "scan", href: "/scan", label: t.nav.scan, Icon: ScanIcon },
  ] as const;
}

/** Passport and Scan as header links on wider screens. */
export function HeaderLinks({ current }: { current: AttendeeSection }) {
  const items = useItems();
  const { t } = useLocale();
  return (
    <nav aria-label={t.nav.attendee} className="hidden items-center gap-1 md:flex">
      {items.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-doc px-3 text-base transition-colors duration-150 hover:bg-paper-deep",
            key === current ? "font-medium text-ink" : "text-ink-soft hover:text-ink",
          )}
        >
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Passport and Scan as a bottom bar on phones, where the thumb is. It sits above the home
 * indicator when the app runs from the home screen.
 */
export function TabBar({ current }: { current: AttendeeSection }) {
  const items = useItems();
  const { t } = useLocale();
  return (
    <nav
      aria-label={t.nav.attendee}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-soft bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-2">
        {items.map(({ key, href, label, Icon }) => {
          const active = key === current;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 text-sm transition-colors duration-150",
                  active ? "font-medium text-ink" : "text-ink-soft",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("absolute top-0 h-0.5 w-10 bg-vermilion transition-opacity duration-150", active ? "opacity-100" : "opacity-0")}
                />
                <Icon className="size-6" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
