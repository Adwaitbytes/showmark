"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { NavItem, NavKey } from "@/lib/copy/site";
import { cn } from "./cn";
import { CloseIcon, MenuIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

interface MobileNavProps {
  items: readonly NavItem[];
  current: NavKey;
}

/** The phone menu: a disclosure under the header, closed by Escape, by a link, or by the button. */
export function MobileNav({ items, current }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-doc px-2 text-ink transition-colors hover:bg-paper-deep"
      >
        {open ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
        <span className="text-base">{open ? "Close" : "Menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-rule-soft bg-paper px-4 pt-2 pb-5 shadow-[0_18px_30px_-24px_rgb(var(--shadow-color)/0.5)]"
      >
        <nav aria-label="Main">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href} className="border-b border-rule-soft last:border-b-0">
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={item.key === current ? "page" : undefined}
                  className={cn(
                    "flex min-h-13 items-center text-lg",
                    item.key === current ? "font-medium text-ink" : "text-ink-soft",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-3 border-t border-rule-soft pt-3">
          <ThemeToggle withLabel className="-ml-2.5" />
        </div>
      </div>
    </div>
  );
}
