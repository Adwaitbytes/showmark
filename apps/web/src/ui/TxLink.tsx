import { explorerTx } from "@/lib/chain/chains";
import { cn } from "./cn";
import { shortHash } from "./format";
import { ExternalIcon } from "./icons";

export interface TxLinkProps {
  hash: string;
  /** Visible text instead of the short hash, for example "View on explorer". */
  children?: React.ReactNode;
  className?: string;
}

/** A transaction on the QIE explorer. Every number Showmark shows should be one click from one of these. */
export function TxLink({ hash, children, className }: TxLinkProps) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4 transition-colors hover:decoration-stamp-blue",
        !children && "font-mono text-sm",
        className,
      )}
    >
      {children ?? shortHash(hash)}
      <ExternalIcon className="size-3.5 shrink-0" />
      <span className="sr-only"> (transaction {hash}, opens the QIE explorer in a new tab)</span>
    </a>
  );
}
