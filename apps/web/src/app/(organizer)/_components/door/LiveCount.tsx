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
  const [previous, setPrevious] = useState(value);
  const from = useRef(value);

  // Adjusting state while rendering when a prop changes, as React recommends, instead of in an effect.
  if (value !== previous) {
    setPrevious(value);
    if (value > previous) setPressKey((k) => k + 1);
  }

  useEffect(() => {
    if (reduce) return;
    const start = from.current;
    const controls = animate(start, value, {
      duration: Math.min(0.9, 0.25 + Math.abs(value - start) * 0.04),
      ease: [0.25, 1, 0.5, 1],
      onUpdate: (v) => {
        from.current = v;
        setShown(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  const display = reduce ? value : shown;

  const full = capacity > 0 && value >= capacity;

  return (
    <div className={cn("flex flex-col", className)}>
      <p className="text-[clamp(0.875rem,1.9vmin,1.375rem)] font-medium tracking-[0.12em] text-ink-soft uppercase">Checked in</p>
      <p
        data-testid="door-count"
        className="relative font-display leading-[0.82] tracking-[-0.03em] text-ink tabular-nums"
        style={{ fontSize: "clamp(5rem, 30vmin, 26rem)" }}
      >
        <span key={pressKey} className={cn("inline-block", pressKey > 0 && "animate-stamp-press")}>
          {formatCount(display)}
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
