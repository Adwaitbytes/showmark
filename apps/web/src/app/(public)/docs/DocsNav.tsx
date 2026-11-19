"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/ui/cn";
import { DOC_PAGES } from "./pages";

/** Docs section navigation: a sticky list on desktop, a scrollable row on phones. */
export function DocsNav() {
  const segment = useSelectedLayoutSegment();
  return (
    <nav aria-label="Docs" className="lg:sticky lg:top-24">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
        {DOC_PAGES.map((page) => {
          const active = (segment ?? "") === page.segment;
          return (
            <li key={page.href} className="shrink-0">
              <Link
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-doc px-3 text-base whitespace-nowrap transition-colors duration-150 lg:whitespace-normal",
                  active ? "bg-paper-deep font-medium text-ink" : "text-ink-soft hover:bg-paper-deep/60 hover:text-ink",
                )}
              >
                {page.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
