"use client";

import type { Stamp as StampData } from "@/lib/api/types";
import { useLocale } from "@/lib/checkin/locale";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { formatDate } from "@/ui/format";
import { Stamp } from "@/ui/stamp/Stamp";
import { TxLink } from "@/ui/TxLink";
import { ScanIcon } from "../_components/icons";

export interface BookletEntry {
  stamp: StampData;
  /** False while only this phone knows about it, before the public index has it. */
  indexed: boolean;
}

/**
 * The stamp pages of the passport. Each stamp keeps its seeded tilt and ink, so a full booklet
 * looks like a desk of real impressions rather than a grid of badges.
 */
export function StampBooklet({ entries, holder }: { entries: readonly BookletEntry[]; holder: string }) {
  const { t } = useLocale();
  return (
    <section aria-labelledby="stamps-title" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="stamps-title" className="font-display text-xl text-ink">
          {t.pass.stampsTitle}
        </h2>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-doc border border-dashed border-rule/60 px-5 py-8">
          <EmptyState
            title={t.pass.emptyTitle}
            align="center"
            action={
              <Button href="/scan" variant="primary" size="lg" leading={<ScanIcon className="size-5" />}>
                {t.pass.scanCta}
              </Button>
            }
          >
            {t.pass.emptyBody}
          </EmptyState>
        </div>
      ) : (
        <ol className="grid grid-cols-2 gap-x-2 gap-y-6 rounded-doc bg-sheet grain px-2 py-4 shadow-sheet sm:grid-cols-3 xl:grid-cols-4">
          {entries.map(({ stamp, indexed }) => (
            <li key={stamp.eventId} className="flex flex-col items-center gap-3 px-2 pt-4 text-center">
              <Stamp
                eventId={stamp.eventId}
                eventName={stamp.eventName}
                city={stamp.city}
                at={stamp.at}
                mode={stamp.mode}
                holder={holder}
                idPrefix={`booklet-${stamp.eventId}`}
                className="w-full max-w-[8.5rem]"
              />
              <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
                <p className="line-clamp-2 text-sm font-medium text-ink">{stamp.eventName}</p>
                <p className="font-mono text-xs text-ink-soft">{formatDate(stamp.at)}</p>
                <TxLink hash={stamp.tx} className="min-h-11 text-xs text-ink-soft! decoration-transparent! hover:decoration-current!" />
                {indexed ? null : <p className="text-xs text-ink-faint">{t.pass.localStampNote}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
