import { cn } from "./cn";
import { formatTokenAmount, formatUsd, type TokenSymbol } from "./format";

export interface AmountProps {
  /** Token base units as a decimal string, exactly as the API returns them. */
  value: string;
  symbol: TokenSymbol;
  /** Override the default precision (QIE 4, QUSDC 2). */
  maxFraction?: number;
  /** Optional USD equivalent, shown after the token amount. */
  usd?: number;
  className?: string;
}

/** A token amount in mono figures with its symbol. Truncates, never rounds up. */
export function Amount({ value, symbol, maxFraction, usd, className }: AmountProps) {
  const figure = formatTokenAmount(value, symbol, maxFraction);
  return (
    <span className={cn("font-mono whitespace-nowrap", className)}>
      <span>{figure}</span>
      <span className="ml-[0.35em] text-[0.82em] text-ink-soft">{symbol}</span>
      {usd !== undefined ? <span className="ml-2 font-sans text-[0.82em] text-ink-soft">about {formatUsd(usd)}</span> : null}
    </span>
  );
}
