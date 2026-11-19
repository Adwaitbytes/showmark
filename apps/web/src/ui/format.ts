import { formatUnits } from "viem";

export type TokenSymbol = "QIE" | "QUSDC";

export const TOKEN_DECIMALS: Record<TokenSymbol, number> = { QIE: 18, QUSDC: 6 };

/** How many fraction digits a person needs to see for each token. */
const DISPLAY_FRACTION: Record<TokenSymbol, number> = { QIE: 4, QUSDC: 2 };
/** Dollar stablecoins always show cents; QIE drops trailing zeros. */
const MIN_FRACTION: Record<TokenSymbol, number> = { QIE: 0, QUSDC: 2 };

/**
 * Events are run in India first, so times show in IST and say so. Every formatter pins the
 * zone and locale, which keeps server and client output identical.
 */
export const DISPLAY_TIME_ZONE = "Asia/Kolkata";
export const DISPLAY_TIME_ZONE_LABEL = "IST";

const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});
const shortDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: DISPLAY_TIME_ZONE,
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: DISPLAY_TIME_ZONE,
});
const weekdayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: DISPLAY_TIME_ZONE });

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

function groupDigits(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats token base units (a decimal string, as the API sends bigints) for reading.
 * Truncates instead of rounding so a balance is never shown as more than it is.
 */
export function formatTokenAmount(baseUnits: string, symbol: TokenSymbol, maxFraction?: number): string {
  if (!/^\d+$/.test(baseUnits)) {
    throw new Error(`Expected base units as a decimal string, got "${baseUnits}"`);
  }
  const raw = BigInt(baseUnits);
  if (raw === BigInt(0)) return MIN_FRACTION[symbol] ? `0.${"0".repeat(MIN_FRACTION[symbol])}` : "0";
  const fractionDigits = maxFraction ?? DISPLAY_FRACTION[symbol];
  const [integerPart, fractionPart = ""] = formatUnits(raw, TOKEN_DECIMALS[symbol]).split(".");
  const significant = fractionPart.slice(0, fractionDigits).replace(/0+$/, "");
  if (integerPart === "0" && significant === "") {
    return `<0.${"0".repeat(Math.max(fractionDigits - 1, 0))}1`;
  }
  const minDigits = Math.min(MIN_FRACTION[symbol], fractionDigits);
  const fraction = significant.padEnd(minDigits, "0");
  const grouped = groupDigits(integerPart ?? "0");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value !== 0 && Math.abs(value) < 10 ? 2 : 0,
  }).format(value);
}

export function formatPercent(ratio: number, fractionDigits = 0): string {
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return shortDateFormat.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return `${timeFormat.format(new Date(iso))} ${DISPLAY_TIME_ZONE_LABEL}`;
}

export function formatWeekday(iso: string): string {
  return weekdayFormat.format(new Date(iso));
}

/** "19 Nov 2026, 18:30 to 21:00 IST", or across days when the event spans midnight. */
export function formatEventWindow(startsAt: string, endsAt: string): string {
  const sameDay = formatDate(startsAt) === formatDate(endsAt);
  const start = timeFormat.format(new Date(startsAt));
  const end = timeFormat.format(new Date(endsAt));
  if (sameDay) return `${formatDate(startsAt)}, ${start} to ${end} ${DISPLAY_TIME_ZONE_LABEL}`;
  return `${formatDate(startsAt)}, ${start} to ${formatDate(endsAt)}, ${end} ${DISPLAY_TIME_ZONE_LABEL}`;
}

export function basisPointsToPercent(bps: number): string {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}
