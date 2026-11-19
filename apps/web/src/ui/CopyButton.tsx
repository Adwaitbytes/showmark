"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { CheckIcon, CopyIcon } from "./icons";

type CopyState = "idle" | "copied" | "failed";

export interface CopyButtonProps {
  value: string;
  /** Spoken name of what is copied, for example "address" or "transaction hash". */
  what: string;
  className?: string;
}

/** Icon button that copies a value and confirms in place, with a polite live announcement. */
export function CopyButton({ value, what, className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // Clipboard needs a secure context and permission; say so instead of failing silently.
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 1800);
  }

  const announcement =
    state === "copied" ? `Copied ${what}` : state === "failed" ? `Could not copy. Select the ${what} and copy it by hand.` : "";

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "relative inline-grid size-7 shrink-0 place-items-center rounded-doc text-ink-soft transition-colors duration-150",
          "before:absolute before:-inset-2 before:content-[''] hover:bg-paper-deep hover:text-ink",
          state === "copied" && "text-ledger-green hover:text-ledger-green",
          state === "failed" && "text-vermilion-ink",
          className,
        )}
        aria-label={`Copy ${what}`}
        title={state === "failed" ? `Could not copy the ${what}` : `Copy ${what}`}
      >
        {state === "copied" ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
