"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "../cn";

/**
 * A short haptic pulse where the device supports it (Android Chrome; iOS Safari has no
 * Vibration API and simply ignores this). Browsers only vibrate after a user gesture, so call it
 * from the handler of the tap that caused the stamp.
 */
export function pressHaptic(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(14);
}

export interface StampPressProps {
  /** Change this value to press again (for example the check-in tx hash). Undefined shows the stamp at rest. */
  pressKey?: string | number;
  /** Fire the haptic pulse with each press. On by default. */
  haptic?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Replays the stamp press (180 ms, small overshoot) whenever pressKey changes, with a haptic
 * pulse. Reduced-motion users see the stamp appear in place; the pulse still confirms it.
 *
 *   <StampPress pressKey={txHash}><Stamp {...params} /></StampPress>
 */
export function StampPress({ pressKey, haptic = true, children, className }: StampPressProps) {
  useEffect(() => {
    if (pressKey !== undefined && haptic) pressHaptic();
  }, [pressKey, haptic]);

  return (
    <span
      key={pressKey === undefined ? "rest" : String(pressKey)}
      className={cn("inline-block", pressKey !== undefined && "animate-stamp-press", className)}
    >
      {children}
    </span>
  );
}
