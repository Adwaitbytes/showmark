"use client";

import type { MouseEvent } from "react";

// With cacheComponents, routes you visited stay mounted but hidden, so the document can briefly hold more than one
// <main id="main">. A plain #main link would land on whichever comes first, which may be hidden. This finds the
// visible one; the href stays as the fallback when JavaScript has not loaded.
function visibleMain(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("main#main"));
  return candidates.find((el) => el.getClientRects().length > 0) ?? null;
}

export function SkipLink() {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const target = visibleMain();
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }

  return (
    <a
      href="#main"
      onClick={onClick}
      className="fixed top-3 left-3 z-50 -translate-y-24 rounded-doc bg-ink px-4 py-3 text-base font-medium text-paper transition-transform focus-visible:translate-y-0"
    >
      Skip to content
    </a>
  );
}
