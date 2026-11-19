"use client";

import { useLocale } from "@/lib/checkin/locale";

export function ScanIntro() {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-2xl text-ink sm:text-3xl">{t.scan.title}</h1>
      <p className="text-base text-ink-soft">{t.scan.instructions}</p>
    </div>
  );
}
