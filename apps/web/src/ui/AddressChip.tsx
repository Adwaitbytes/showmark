import Link from "next/link";
import { explorerAddress } from "@/lib/chain/chains";
import { cn } from "./cn";
import { CopyButton } from "./CopyButton";
import { shortAddress } from "./format";
import { ExternalIcon } from "./icons";

export interface AddressChipProps {
  address: string;
  /** The holder's .qie name when they have one. Shown first; the address stays visible beside it. */
  name?: string | null;
  /** Where the name or address links: the public passport, the explorer, or nowhere. */
  link?: "passport" | "explorer" | "none";
  /** Show the copy button. On by default. */
  copy?: boolean;
  className?: string;
}

/**
 * An address the way people can read it: a .qie name when there is one, otherwise the short
 * mono address, with copy and an explorer link. The full address is in the title and the
 * spoken label.
 */
export function AddressChip({ address, name, link = "explorer", copy = true, className }: AddressChipProps) {
  const short = shortAddress(address);
  const text = (
    <>
      {name ? <span className="font-sans font-medium text-ink">{name}</span> : null}
      <span className={cn("font-mono", name ? "text-xs text-ink-soft" : "text-sm text-ink")}>{short}</span>
    </>
  );
  const label = name ? `${name}, address ${address}` : `Address ${address}`;
  const linkClass =
    "inline-flex min-h-8 items-baseline gap-2 rounded-doc underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current";

  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1 rounded-doc bg-paper-deep py-0.5 pr-0.5 pl-2.5", className)}
      title={address}
    >
      {link === "passport" ? (
        <Link href={`/p/${name ?? address}`} className={linkClass} aria-label={`${label}. Open passport`}>
          {text}
        </Link>
      ) : link === "explorer" ? (
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label={`${label}. Open in the QIE explorer, new tab`}
        >
          {text}
          <ExternalIcon className="size-3.5 self-center text-ink-soft" />
        </a>
      ) : (
        <span className="inline-flex min-h-8 items-baseline gap-2" aria-label={label}>
          {text}
        </span>
      )}
      {copy ? <CopyButton value={address} what="address" /> : null}
    </span>
  );
}
