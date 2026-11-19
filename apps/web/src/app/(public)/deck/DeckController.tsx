"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const SLIDE_COUNT = 10;

function slideFromHash(): number {
  const n = Number(window.location.hash.replace("#", ""));
  return Number.isInteger(n) && n >= 1 && n <= SLIDE_COUNT ? n : 1;
}

/**
 * Presenter controls for the deck: arrows, space, PageUp and PageDown, Home and End move between
 * slides; the slide number lives in the URL hash; f toggles full screen; n (or ?notes=1) shows the
 * speaker notes. Slides themselves are server-rendered children.
 */
export function DeckController({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const current = useRef(1);
  // While a key press scrolls smoothly past other slides, the observer must not report them.
  const flying = useRef<number | null>(null);
  const [announce, setAnnounce] = useState("");

  const goTo = useCallback((n: number) => {
    const target = Math.min(SLIDE_COUNT, Math.max(1, n));
    const slide = root.current?.querySelector<HTMLElement>(`[data-slide="${target}"]`);
    if (!slide) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flying.current = target;
    window.setTimeout(() => {
      if (flying.current === target) flying.current = null;
    }, 1200);
    slide.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    current.current = target;
    history.replaceState(null, "", `#${target}`);
    setAnnounce(`Slide ${target} of ${SLIDE_COUNT}`);
  }, []);

  // The site keeps scroll padding for its sticky header; the deck has none, so slides align to the top.
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.scrollPaddingTop;
    html.style.scrollPaddingTop = "0px";
    return () => {
      html.style.scrollPaddingTop = previous;
    };
  }, []);

  // Start on the slide in the hash, and pick up ?notes=1.
  useEffect(() => {
    // Notes visibility is a DOM attribute, not React state, so a ?notes=1 link never causes a hydration mismatch.
    if (root.current) root.current.dataset.notes = new URLSearchParams(window.location.search).get("notes") === "1" ? "on" : "off";
    const start = slideFromHash();
    current.current = start;
    if (start > 1) root.current?.querySelector<HTMLElement>(`[data-slide="${start}"]`)?.scrollIntoView({ block: "start" });
  }, []);

  // Keep the hash in step with scrolling (phones, trackpads, clickers that scroll).
  useEffect(() => {
    const slides = root.current?.querySelectorAll<HTMLElement>("[data-slide]");
    if (!slides) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = Number((entry.target as HTMLElement).dataset.slide);
          if (flying.current !== null && n !== flying.current) continue;
          if (n === flying.current) flying.current = null;
          if (n && n !== current.current) {
            current.current = n;
            history.replaceState(null, "", `#${n}`);
          }
        }
      },
      { threshold: 0.6 },
    );
    slides.forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const next = ["ArrowRight", "ArrowDown", "PageDown", " "];
      const previous = ["ArrowLeft", "ArrowUp", "PageUp"];
      if (next.includes(event.key)) {
        event.preventDefault();
        goTo(event.shiftKey && event.key === " " ? current.current - 1 : current.current + 1);
      } else if (previous.includes(event.key)) {
        event.preventDefault();
        goTo(current.current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goTo(1);
      } else if (event.key === "End") {
        event.preventDefault();
        goTo(SLIDE_COUNT);
      } else if (event.key === "f" || event.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => setAnnounce("Full screen is not available here"));
      } else if (event.key === "n" || event.key === "N") {
        const el = root.current;
        if (el) {
          el.dataset.notes = el.dataset.notes === "on" ? "off" : "on";
          setAnnounce(el.dataset.notes === "on" ? "Speaker notes shown" : "Speaker notes hidden");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  return (
    <main
      ref={root}
      id="main"
      tabIndex={-1}
      className="group/deck focus:outline-none lg:landscape:h-dvh lg:landscape:snap-y lg:landscape:snap-mandatory lg:landscape:overflow-y-auto"
    >
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {children}
    </main>
  );
}
