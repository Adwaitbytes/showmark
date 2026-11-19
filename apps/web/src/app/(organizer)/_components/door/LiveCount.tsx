"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatCount } from "@/ui/format";
import { cn } from "@/ui/cn";

interface Props {
  value: number;
  capacity: number;
  stale: boolean;
  className?: string;
}

/**
 * The centerpiece of the door screen. The number counts up to each new value and the figure lands like a stamp, so
 * the room sees every check-in arrive.
 */
export function LiveCount({ value, capacity, stale, className }: Props) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [pressKey, setPressKey] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;
    if (value > from) setPressKey((k) => k + 1);
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(from, value, {
      duration: Math.min(0.9, 0.25 + Math.abs(value - from) * 0.04),
      ease: [0.25, 1, 0.5, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduce]);

  const full = capacity > 0 && value >= capacity;

  return (
    <div className={cn("flex flex-col", className)}>
      <p className="text-[clamp(0.875rem,1.9vmin,1.375rem)] font-medium tracking-[0.12em] text-ink-soft uppercase">Checked in</p>
      <p
        data-testid="door-count"
        className="relative font-display leading-[0.82] tracking-[-0.03em] text-ink tabular-nums"
        style={{ fontSize: "clamp(6rem, 26vmin, 22rem)" }}
      >
        <span key={pressKey} className={cn("inline-block", pressKey > 0 && "animate-stamp-press")}>
          {formatCount(shown)}
        </span>
      </p>
      <p className="mt-[1.2vmin] text-[clamp(1rem,2.4vmin,1.75rem)] text-ink-soft">
        {capacity > 0 ? (
          full ? (
            <span className="font-medium text-vermilion-ink">Full. Capacity is {formatCount(capacity)}.</span>
          ) : (
            <>
              of {formatCount(capacity)} places
            </>
          )
        ) : (
          "No capacity limit"
        )}
        {stale ? <span className="block text-[0.8em] text-ink-faint">Reconnecting. The count may be a few seconds behind.</span> : null}
      </p>
      <span className="sr-only" aria-live="polite">
        {formatCount(value)} checked in
      </span>
    </div>
  );
}
