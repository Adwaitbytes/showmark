"use client";

import { useSyncExternalStore } from "react";
import { cn } from "./cn";
import { MoonIcon, SunIcon, SystemIcon } from "./icons";
import { THEME_STORAGE_KEY } from "./theme";

type ThemeChoice = "system" | "light" | "dark";

const ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];
const NAMES: Record<ThemeChoice, string> = { system: "Match device", light: "Paper", dark: "Night desk" };

const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private mode can block storage; the theme still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

/** Cycles device, paper and night desk. The inline script in the root layout restores it before paint. */
export function ThemeToggle({ className, withLabel = false }: { className?: string; withLabel?: boolean }) {
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, readChoice, () => "system");
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? "system";
  const Icon = choice === "light" ? SunIcon : choice === "dark" ? MoonIcon : SystemIcon;

  return (
    <button
      type="button"
      onClick={() => applyChoice(next)}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-doc px-2.5 text-ink-soft transition-colors duration-150 hover:bg-paper-deep hover:text-ink",
        className,
      )}
      aria-label={`Theme: ${NAMES[choice]}. Switch to ${NAMES[next]}`}
    >
      <Icon className="size-5" />
      {withLabel ? <span className="text-base text-ink">{NAMES[choice]}</span> : null}
    </button>
  );
}
