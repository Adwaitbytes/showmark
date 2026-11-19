"use client";

import Link from "next/link";
import { useLocale } from "@/lib/checkin/locale";

/** Title, one-line reason and a way back, for the screens under the passport. */
export function SubpageIntro({ page }: { page: "link" | "withdraw" }) {
  const { t } = useLocale();
  const copy = page === "link" ? { title: t.link.title, body: t.checkIn.linkWhy } : { title: t.withdraw.title, body: t.withdraw.body };
  return (
    <div className="flex flex-col gap-2">
      <Link
        href="/pass"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-doc px-1 text-base text-ink-soft underline-offset-4 hover:text-ink hover:underline"
      >
        <span aria-hidden="true">&larr;</span>
        {t.common.backToPassport}
      </Link>
      <h1 className="font-display text-2xl text-ink sm:text-3xl">{copy.title}</h1>
      <p className="text-base text-ink-soft">{copy.body}</p>
    </div>
  );
}
