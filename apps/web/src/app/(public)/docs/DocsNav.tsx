"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/ui/cn";
import { DOC_PAGES } from "./pages";

/** Docs section navigation: a sticky list on desktop, a scrollable row on phones. */
export function DocsNav() {
  const segment = useSelectedLayoutSegment();
  const list = useRef<HTMLUListElement>(null);

  // On phones the list scrolls sideways; keep the current page in view.
  useEffect(() => {
    const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current || !list.current || list.current.scrollWidth <= list.current.clientWidth) return;
    list.current.scrollTo({ left: current.offsetLeft - list.current.clientWidth / 2 + current.clientWidth / 2 });
  }, [segment]);

  return (
    <nav aria-label="Docs" className="lg:sticky lg:top-24">
      <ul
        ref={list}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(90deg,#000_85%,transparent)] lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:[mask-image:none]"
      >
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
