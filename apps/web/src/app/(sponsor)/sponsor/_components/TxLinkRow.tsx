import { TxLink } from "@/ui/TxLink";

/** A labelled transaction link, for confirmations and report headers. */
export function TxLinkRow({ hash, label }: { hash: string; label: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-ink-soft">
      <span>{label}</span>
      <TxLink hash={hash} />
    </p>
  );
}
