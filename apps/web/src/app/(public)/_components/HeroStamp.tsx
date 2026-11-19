"use client";

import { useState } from "react";
import { Stamp, type StampProps } from "@/ui/stamp/Stamp";
import { pressHaptic } from "@/ui/stamp/StampPress";

/**
 * The landing page's one orchestrated moment: the specimen stamp presses once shortly after
 * load (pure CSS, so it also runs without JavaScript), and again whenever the visitor asks.
 */
export function HeroStamp({ stamp }: { stamp: Omit<StampProps, "press" | "className"> }) {
  const [presses, setPresses] = useState(0);

  return (
    <div className="flex flex-col items-center gap-3">
      <span
        key={presses}
        className="inline-block animate-stamp-press"
        style={{ animationDelay: presses === 0 ? "700ms" : "0ms" }}
      >
        <Stamp {...stamp} holder={`${stamp.holder ?? ""}:${presses}`} className="w-36 sm:w-40" />
      </span>
      <button
        type="button"
        onClick={() => {
          pressHaptic();
          setPresses((count) => count + 1);
        }}
        className="inline-flex min-h-11 items-center rounded-doc px-3 text-sm text-ink-soft underline decoration-rule underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
      >
        Press again
      </button>
    </div>
  );
}
