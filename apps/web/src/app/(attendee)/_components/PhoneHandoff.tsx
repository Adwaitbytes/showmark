"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/checkin/locale";
import { QrFrame } from "@/ui/QrFrame";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { Skeleton } from "@/ui/Skeleton";
import { ShowmarkSeal } from "@/ui/Wordmark";

const DESKTOP = "(min-width: 1024px)";

/**
 * Desktop side panel for the phone-first attendee screens: a code that opens this same page on a
 * phone. The pass lives on the phone that checked in, so on a laptop the useful next step is
 * usually to move there. The QR library loads only on wide screens.
 */
export function PhoneHandoff({ page }: { page: "scan" | "link" | "withdraw" }) {
  const { t } = useLocale();
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    let cancelled = false;
    async function draw() {
      if (!query.matches || cancelled) return;
      const QRCode = await import("qrcode");
      const url = `${window.location.origin}${window.location.pathname}`;
      const markup = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#141311", light: "#00000000" } });
      if (!cancelled) setSvg(markup);
    }
    void draw().catch(() => {
      // Without the code the panel still says what to do.
    });
    query.addEventListener("change", draw);
    return () => {
      cancelled = true;
      query.removeEventListener("change", draw);
    };
  }, []);

  const copy = page === "scan" ? t.handoff.scan : t.handoff.pass;

  return (
    <aside aria-labelledby="handoff-title" className="hidden lg:block">
      <Sheet className="sticky top-24">
        <SheetSection className="flex flex-col gap-5">
          <ShowmarkSeal className="size-10" />
          <div className="flex flex-col gap-2">
            <h2 id="handoff-title" className="font-display text-xl text-ink">
              {copy.title}
            </h2>
            <p className="text-base text-ink-soft">{copy.body}</p>
          </div>
          <div className="mx-auto w-full max-w-[13rem]">
            <QrFrame label={copy.qrLabel} caption={t.handoff.caption}>
              {svg ? <span className="block size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton className="size-full" />}
            </QrFrame>
          </div>
        </SheetSection>
      </Sheet>
    </aside>
  );
}
