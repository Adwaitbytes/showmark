"use client";

import { useEffect } from "react";
import { setLocale, useLocale } from "@/lib/checkin/locale";
import { cn } from "@/ui/cn";

/**
 * Switches the attendee app between English and Hindi. The button shows the language you would
 * switch to, written in that language, so someone who reads only that language can find it.
 * Also keeps <html lang> in step so screen readers pick the right voice.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const next = locale === "en" ? "hi" : "en";

  useEffect(() => {
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = "en";
    };
  }, [locale]);

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={t.lang.switchLabel}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-doc px-3 text-base font-medium text-ink shadow-[inset_0_0_0_1px_var(--rule-soft)] transition-colors duration-150 hover:bg-paper-deep hover:shadow-[inset_0_0_0_1px_var(--rule)]",
        className,
      )}
    >
      <span lang={next}>{t.lang.switchTo}</span>
    </button>
  );
}
