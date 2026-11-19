import Link from "next/link";
import { DOC_PAGES } from "./pages";

type Segment = (typeof DOC_PAGES)[number]["segment"];

/** Previous and next links at the foot of each docs page, in table of contents order. */
export function DocPager({ current }: { current: Segment }) {
  const index = DOC_PAGES.findIndex((page) => page.segment === current);
  const previous = index > 0 ? DOC_PAGES[index - 1] : undefined;
  const next = index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : undefined;
  return (
    <nav aria-label="More docs" className="mt-16 grid grid-cols-1 max-w-[42rem] gap-3 border-t border-rule-soft pt-6 sm:grid-cols-2">
      {previous ? (
        <Link href={previous.href} className="flex min-h-16 flex-col justify-center rounded-doc px-4 py-3 transition-colors hover:bg-paper-deep">
          <span className="text-sm text-ink-faint">Previous</span>
          <span className="text-base font-medium text-ink">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="flex min-h-16 flex-col justify-center rounded-doc px-4 py-3 text-right transition-colors hover:bg-paper-deep"
        >
          <span className="text-sm text-ink-faint">Next</span>
          <span className="text-base font-medium text-ink">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
