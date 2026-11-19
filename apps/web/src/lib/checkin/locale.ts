"use client";

import { useSyncExternalStore } from "react";
import { en, type Dictionary, type ErrorTables, type Locale } from "./i18n";
import { browserStorage } from "./storage";

const STORAGE_KEY = "showmark.lang";

interface Hindi {
  t: Dictionary;
  errors: ErrorTables;
}

export interface LocaleState {
  locale: Locale;
  t: Dictionary;
  /** Translated error tables, or null in English, where the API's own words are shown. */
  errors: ErrorTables | null;
}

const ENGLISH: LocaleState = { locale: "en", t: en, errors: null };

const listeners = new Set<() => void>();
let wanted: Locale | null = null;
let hindi: Hindi | null = null;
let loading: Promise<void> | null = null;
let snapshot: LocaleState = ENGLISH;

function notify(): void {
  snapshot = wanted === "hi" && hindi ? { locale: "hi", t: hindi.t, errors: hindi.errors } : ENGLISH;
  for (const listener of listeners) listener();
}

/** Hindi is a separate chunk, fetched the first time someone needs it. English shows until it lands. */
function loadHindi(): void {
  loading ??= import("./i18n-hi")
    .then((module) => {
      hindi = { t: module.hi, errors: module.hindiErrors };
      notify();
    })
    .catch(() => {
      // Stay in English and let a later toggle try again.
      loading = null;
    });
}

function initialLocale(): Locale {
  const saved = browserStorage()?.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "hi") return saved;
  // First visit: follow the phone's language, so a Hindi phone opens in Hindi.
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("hi") ? "hi" : "en";
}

function getSnapshot(): LocaleState {
  if (wanted === null) {
    wanted = initialLocale();
    if (wanted === "hi") loadHindi();
  }
  return snapshot;
}

function getServerSnapshot(): LocaleState {
  return ENGLISH;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocale(locale: Locale): void {
  wanted = locale;
  try {
    browserStorage()?.setItem(STORAGE_KEY, locale);
  } catch {
    // The choice still applies for this visit.
  }
  if (locale === "hi" && !hindi) loadHindi();
  notify();
}

/** The attendee app's language. Server renders English; the saved choice applies on hydration. */
export function useLocale(): LocaleState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
