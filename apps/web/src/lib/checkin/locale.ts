"use client";

import { useSyncExternalStore } from "react";
import { dictionaries, type Dictionary, type Locale } from "./i18n";
import { browserStorage } from "./storage";

const STORAGE_KEY = "showmark.lang";

const listeners = new Set<() => void>();
let current: Locale | null = null;

function initialLocale(): Locale {
  const saved = browserStorage()?.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "hi") return saved;
  // First visit: follow the phone's language, so a Hindi phone opens in Hindi.
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("hi") ? "hi" : "en";
}

function getSnapshot(): Locale {
  current ??= initialLocale();
  return current;
}

function getServerSnapshot(): Locale {
  return "en";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    browserStorage()?.setItem(STORAGE_KEY, locale);
  } catch {
    // The choice still applies for this visit.
  }
  for (const listener of listeners) listener();
}

export interface LocaleState {
  locale: Locale;
  t: Dictionary;
}

/** The attendee app's language. Server renders English; the saved choice applies on hydration. */
export function useLocale(): LocaleState {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { locale, t: dictionaries[locale] };
}
