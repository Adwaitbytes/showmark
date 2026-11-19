import Link from "next/link";
import { cn } from "./cn";

export interface LinkTabItem {
  href: string;
  label: string;
}

export interface LinkTabsProps {
  /** Spoken name of the navigation, for example "Campaign sections". */
  label: string;
  items: readonly LinkTabItem[];
  /** href of the current page. */
  current: string;
  className?: string;
}

/** Route-level tabs: a nav of links with the current one marked by aria-current. Server-rendered, no JS. */
export function LinkTabs({ label, items, current, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn("border-b border-rule-soft", className)}>
      <ul className="flex gap-6 overflow-x-auto">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-end border-b-2 pb-2 text-base whitespace-nowrap transition-colors duration-150",
                  active ? "border-ink font-medium text-ink" : "border-transparent text-ink-soft hover:border-rule hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
