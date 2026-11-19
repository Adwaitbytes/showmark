import { createRng, hashSeed, r1 } from "../seed";
import { DISPLAY_TIME_ZONE, formatDate } from "../format";

/**
 * A rubber stamp as a standalone SVG string. Pure and dependency-free so the same artwork is
 * used by the <Stamp> component, by /api/stamp/[id] (ERC-1155 metadata image) and by anything
 * that renders on the server.
 *
 * Design is seeded by the event: everyone who attends an event gets the same stamp shape and
 * ink. The tilt is seeded by event and holder, so each impression lands a little differently.
 * A double inner rim marks the strongest proof (mode 2, "door scans you").
 */

export type StampInk = "vermilion" | "stamp-blue" | "ledger-green" | "ink";
export type StampShape = "round" | "oval" | "box";

export interface StampParams {
  eventId: string;
  eventName: string;
  city?: string | null;
  /** ISO timestamp of the check-in, or of the event start for a preview. */
  at: string;
  mode: 1 | 2;
  /** The pass or wallet address the stamp belongs to; varies the tilt per holder. */
  holder?: string;
  ink?: StampInk;
  shape?: StampShape;
  /**
   * "css" paints with the theme variables (for inline use in the app, follows night desk).
   * "print" paints with fixed hex inks (for standalone images such as NFT metadata).
   */
  color?: "css" | "print";
  /** Bake the tilt into the SVG. The <Stamp> component turns this off and tilts with CSS. */
  rotate?: boolean;
  /** Prefix for filter ids. Must be unique per page when the same stamp appears twice. */
  idPrefix?: string;
  /** Printed after "NO." on the stamp. Defaults to the event id; null prints no number (previews). */
  serial?: string | null;
}

export interface StampSpec {
  shape: StampShape;
  ink: StampInk;
  /** Degrees, never flatter than 2 so a stamp never looks machine placed. */
  rotation: number;
  width: number;
  height: number;
  label: string;
}

const PRINT_INK: Record<StampInk, string> = {
  vermilion: "#E4442B",
  "stamp-blue": "#2B4BD9",
  "ledger-green": "#1F6B45",
  ink: "#141311",
};

const CANVAS: Record<StampShape, { width: number; height: number }> = {
  round: { width: 220, height: 220 },
  oval: { width: 260, height: 180 },
  box: { width: 280, height: 190 },
};

/** Average advance of an uppercase bold grotesk glyph, in ems. Used to fit text to an arc. */
const GLYPH_EM = 0.66;

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: DISPLAY_TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: DISPLAY_TIME_ZONE });
const yearFormat = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: DISPLAY_TIME_ZONE });

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Strips control characters and collapses whitespace in on-chain metadata before it is drawn. */
function clean(text: string): string {
  return Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function fitText(
  raw: string,
  available: number,
  maxSize: number,
  minSize: number,
  trackingEm: number,
): { text: string; size: number } {
  const text = clean(raw).toUpperCase();
  const perChar = GLYPH_EM + trackingEm;
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    if (text.length * size * perChar <= available) return { text, size };
  }
  const maxChars = Math.max(4, Math.floor(available / (minSize * perChar)));
  return { text: `${text.slice(0, maxChars - 1).trimEnd()}…`, size: minSize };
}

function serialTspan(p: StampParams, size: number): string {
  const serial = p.serial === undefined ? p.eventId : p.serial;
  if (serial === null || clean(serial) === "") return "";
  return `<tspan dx="${r1(size * 0.9)}">NO. ${escapeXml(clean(serial))}</tspan>`;
}

function star(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.42;
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${r1(cx + radius * Math.cos(angle))},${r1(cy + radius * Math.sin(angle))}`);
  }
  return `<polygon points="${points.join(" ")}"/>`;
}

export function stampSpec(params: Pick<StampParams, "eventId" | "eventName" | "city" | "at" | "mode" | "holder" | "ink" | "shape">): StampSpec {
  const design = createRng(`stamp:${params.eventId}`);
  const shape = params.shape ?? design.pick(["round", "round", "oval", "box"] as const);
  const ink =
    params.ink ??
    design.pick(["stamp-blue", "stamp-blue", "stamp-blue", "ink", "ink", "vermilion", "ledger-green"] as const);
  const tilt = createRng(`tilt:${params.eventId}:${params.holder ?? ""}`);
  const rotation = r1((tilt.next() < 0.5 ? -1 : 1) * tilt.range(2, 9.5));
  const city = params.city ? clean(params.city) : "";
  const proof = params.mode === 2 ? "scanned at the door" : "checked in with the rotating door code";
  const label = `Showmark stamp for ${clean(params.eventName)}${city ? `, ${city}` : ""}, ${formatDate(params.at)}, ${proof}`;
  return { shape, ink, rotation, ...CANVAS[shape], label };
}

interface Painted {
  inkColor: string;
}

function dateParts(at: string): { day: string; month: string; year: string } {
  const date = new Date(at);
  return {
    day: dayFormat.format(date),
    month: monthFormat.format(date).toUpperCase().replace(".", ""),
    year: yearFormat.format(date),
  };
}

function roundBody(p: StampParams, paint: Painted, id: string): string {
  const c = 110;
  const { day, month, year } = dateParts(p.at);
  const top = fitText(p.eventName, 186, 13, 8.5, 0.14);
  const bottomText = `${p.city ? clean(p.city) : "SHOWMARK"}`;
  const bottom = fitText(bottomText, 128, 10.5, 8, 0.18);
  const ring = (r: number, w: number) => `<circle cx="${c}" cy="${c}" r="${r}" stroke-width="${w}"/>`;
  return [
    `<defs>`,
    `<path id="${id}-top" d="M${c - 72} ${c} A72 72 0 0 1 ${c + 72} ${c}"/>`,
    `<path id="${id}-bot" d="M${c - 79} ${c} A79 79 0 0 0 ${c + 79} ${c}"/>`,
    `</defs>`,
    `<g fill="none" stroke="${paint.inkColor}">`,
    ring(96, 3.4),
    ring(89, 1.1),
    ring(60, 1.1),
    p.mode === 2 ? ring(56, 0.9) : "",
    `<line x1="${c - 50}" y1="${c - 13}" x2="${c + 50}" y2="${c - 13}" stroke-width="0.9"/>`,
    `<line x1="${c - 50}" y1="${c + 15}" x2="${c + 50}" y2="${c + 15}" stroke-width="0.9"/>`,
    `</g>`,
    `<g fill="${paint.inkColor}" font-weight="700" text-anchor="middle">`,
    star(c - 76, c + 1, 5),
    star(c + 76, c + 1, 5),
    `<text font-size="${top.size}" letter-spacing="${r1(top.size * 0.14)}"><textPath href="#${id}-top" startOffset="50%">${escapeXml(top.text)}</textPath></text>`,
    `<text font-size="${bottom.size}" letter-spacing="${r1(bottom.size * 0.18)}"><textPath href="#${id}-bot" startOffset="50%">${escapeXml(bottom.text)}${serialTspan(p, bottom.size)}</textPath></text>`,
    `<text x="${c}" y="${c - 22}" font-size="8.5" letter-spacing="2">PRESENT</text>`,
    `<text x="${c}" y="${c + 9}" font-size="22" letter-spacing="0.5">${escapeXml(`${day} ${month}`)}</text>`,
    `<text x="${c}" y="${c + 30}" font-size="10" letter-spacing="2.4">${escapeXml(year)}</text>`,
    `</g>`,
  ].join("");
}

function ovalBody(p: StampParams, paint: Painted, id: string): string {
  const cx = 130;
  const cy = 90;
  const { day, month, year } = dateParts(p.at);
  const top = fitText(p.eventName, 200, 12.5, 8.5, 0.14);
  const bottom = fitText(p.city ? clean(p.city) : "SHOWMARK", 120, 10, 8, 0.18);
  const ellipse = (rx: number, ry: number, w: number) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke-width="${w}"/>`;
  return [
    `<defs>`,
    `<path id="${id}-top" d="M${cx - 92} ${cy} A92 52 0 0 1 ${cx + 92} ${cy}"/>`,
    `<path id="${id}-bot" d="M${cx - 100} ${cy} A100 60 0 0 0 ${cx + 100} ${cy}"/>`,
    `</defs>`,
    `<g fill="none" stroke="${paint.inkColor}">`,
    ellipse(116, 76, 3.2),
    ellipse(109, 69, 1.1),
    ellipse(72, 30, 1.1),
    p.mode === 2 ? ellipse(68, 26.5, 0.9) : "",
    `</g>`,
    `<g fill="${paint.inkColor}" font-weight="700" text-anchor="middle">`,
    star(cx - 98, cy + 1, 4.5),
    star(cx + 98, cy + 1, 4.5),
    `<text font-size="${top.size}" letter-spacing="${r1(top.size * 0.14)}"><textPath href="#${id}-top" startOffset="50%">${escapeXml(top.text)}</textPath></text>`,
    `<text font-size="${bottom.size}" letter-spacing="${r1(bottom.size * 0.18)}"><textPath href="#${id}-bot" startOffset="50%">${escapeXml(bottom.text)}${serialTspan(p, bottom.size)}</textPath></text>`,
    `<text x="${cx}" y="${cy - 8}" font-size="8" letter-spacing="2">PRESENT</text>`,
    `<text x="${cx}" y="${cy + 14}" font-size="18" letter-spacing="0.6">${escapeXml(`${day} ${month} ${year}`)}</text>`,
    `</g>`,
  ].join("");
}

function boxBody(p: StampParams, paint: Painted): string {
  const cx = 140;
  const { day, month, year } = dateParts(p.at);
  const name = fitText(p.eventName, 214, 13.5, 8.5, 0.12);
  const bottom = fitText(`${p.city ? clean(p.city) : "SHOWMARK"}`, 130, 10, 8, 0.16);
  const rect = (inset: number, w: number, radius: number) =>
    `<rect x="${18 + inset}" y="${23 + inset}" width="${244 - inset * 2}" height="${144 - inset * 2}" rx="${radius}" stroke-width="${w}"/>`;
  return [
    `<g fill="none" stroke="${paint.inkColor}">`,
    rect(0, 3.2, 10),
    rect(6, 1.1, 6),
    p.mode === 2 ? rect(9.5, 0.9, 4) : "",
    `<line x1="40" y1="74" x2="240" y2="74" stroke-width="0.9"/>`,
    `<line x1="40" y1="134" x2="240" y2="134" stroke-width="0.9"/>`,
    `</g>`,
    `<g fill="${paint.inkColor}" font-weight="700" text-anchor="middle">`,
    `<text x="${cx}" y="62" font-size="${name.size}" letter-spacing="${r1(name.size * 0.12)}">${escapeXml(name.text)}</text>`,
    `<text x="${cx}" y="94" font-size="8.5" letter-spacing="2.2">PRESENT</text>`,
    `<text x="${cx}" y="123" font-size="24" letter-spacing="0.6">${escapeXml(`${day} ${month} ${year}`)}</text>`,
    `<text x="${cx}" y="154" font-size="${bottom.size}" letter-spacing="${r1(bottom.size * 0.16)}">${escapeXml(bottom.text)}${serialTspan(p, bottom.size)}</text>`,
    `</g>`,
  ].join("");
}

/**
 * Rubber-stamp texture: the edge is roughened by displacement, ink coverage thins in soft
 * patches, and a few pinholes drop out, the way a real stamp prints on paper.
 */
function inkBleedFilter(id: string, seed: number, width: number, height: number): string {
  return [
    `<filter id="${id}-ink" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`,
    `<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed % 997}" result="grit"/>`,
    `<feDisplacementMap in="SourceGraphic" in2="grit" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough"/>`,
    `<feGaussianBlur in="rough" stdDeviation="0.28" result="bleed"/>`,
    `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="${(seed >>> 3) % 991}" result="blot"/>`,
    `<feColorMatrix in="blot" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.1 2.05" result="coverage"/>`,
    `<feComposite in="bleed" in2="coverage" operator="in" result="inked"/>`,
    `<feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="${(seed >>> 7) % 983}" result="speck"/>`,
    `<feColorMatrix in="speck" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -9 6.7" result="holes"/>`,
    `<feComposite in="inked" in2="holes" operator="in"/>`,
    `</filter>`,
  ].join("");
}

export function stampSvg(params: StampParams): string {
  const spec = stampSpec(params);
  const seed = hashSeed(`${params.eventId}:${params.holder ?? ""}`);
  const id = `${params.idPrefix ?? "sm"}-${seed.toString(36)}`;
  const css = (params.color ?? "css") === "css";
  // Everything paints with currentColor, so the theme (css) or a fixed ink (print) is set once here.
  const paint: Painted = { inkColor: "currentColor" };
  const rootPaint = css
    ? `style="color:var(--${spec.ink});font-family:var(--font-geist),Arial,sans-serif"`
    : `color="${PRINT_INK[spec.ink]}" font-family="Geist, 'Helvetica Neue', Arial, sans-serif"`;
  const body =
    spec.shape === "round"
      ? roundBody(params, paint, id)
      : spec.shape === "oval"
        ? ovalBody(params, paint, id)
        : boxBody(params, paint);
  const cx = spec.width / 2;
  const cy = spec.height / 2;
  const tilt = params.rotate === false ? "" : ` transform="rotate(${spec.rotation} ${cx} ${cy})"`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}" height="${spec.height}" ${rootPaint} role="img" aria-label="${escapeXml(spec.label)}">`,
    `<title>${escapeXml(spec.label)}</title>`,
    `<defs>${inkBleedFilter(id, seed, spec.width, spec.height)}</defs>`,
    `<g filter="url(#${id}-ink)" opacity="0.9"><g${tilt}>${body}</g></g>`,
    `</svg>`,
  ].join("");
}

/** A base64 data URI for <img src> and token metadata. Works in Node and in the browser. */
export function stampDataUri(params: StampParams): string {
  const bytes = new TextEncoder().encode(stampSvg({ ...params, color: "print" }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export interface MarkParams {
  /** One or two short lines, printed in capitals: ["Awaiting", "first check-in"]. */
  lines: readonly [string] | readonly [string, string];
  ink?: StampInk;
  /** Seeds the tilt and the ink texture so the same mark always prints the same way. */
  seed: string;
  color?: "css" | "print";
  rotate?: boolean;
  idPrefix?: string;
}

/**
 * A rubber office mark (a framed word or two, like RECEIVED or VOID) in the same inks and ink
 * bleed as the event stamps. Used for states: "Awaiting first check-in", "Not admitted".
 */
export function markSpec(params: Pick<MarkParams, "seed" | "lines">): { rotation: number; width: number; height: number; label: string } {
  const tilt = createRng(`mark:${params.seed}`);
  const rotation = r1((tilt.next() < 0.5 ? -1 : 1) * tilt.range(4, 9));
  return { rotation, width: 300, height: params.lines.length === 2 ? 132 : 96, label: params.lines.map(clean).join(" ") };
}

export function markSvg(params: MarkParams): string {
  const spec = markSpec(params);
  const ink = params.ink ?? "vermilion";
  const seed = hashSeed(`mark:${params.seed}`);
  const id = `${params.idPrefix ?? "mk"}-${seed.toString(36)}`;
  const css = (params.color ?? "css") === "css";
  const rootPaint = css
    ? `style="color:var(--${ink});font-family:var(--font-geist),Arial,sans-serif"`
    : `color="${PRINT_INK[ink]}" font-family="Geist, 'Helvetica Neue', Arial, sans-serif"`;
  const { width, height } = spec;
  const lines = params.lines.map((line, index) => {
    const fitted = fitText(line, 236, index === 0 ? 30 : 22, 12, 0.06);
    return { ...fitted, y: params.lines.length === 1 ? 61 : index === 0 ? 62 : 98 };
  });
  const tilt = params.rotate === false ? "" : ` transform="rotate(${spec.rotation} ${width / 2} ${height / 2})"`;
  const body = [
    `<g fill="none" stroke="currentColor">`,
    `<rect x="14" y="12" width="${width - 28}" height="${height - 24}" rx="6" stroke-width="3.6"/>`,
    `<rect x="21" y="19" width="${width - 42}" height="${height - 38}" rx="3" stroke-width="1.2"/>`,
    `</g>`,
    `<g fill="currentColor" font-weight="800" text-anchor="middle">`,
    ...lines.map(
      (line) =>
        `<text x="${width / 2}" y="${line.y}" font-size="${line.size}" letter-spacing="${r1(line.size * 0.06)}">${escapeXml(line.text)}</text>`,
    ),
    `</g>`,
  ].join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${rootPaint} role="img" aria-label="${escapeXml(spec.label)}">`,
    `<title>${escapeXml(spec.label)}</title>`,
    `<defs>${inkBleedFilter(id, seed, width, height)}</defs>`,
    `<g filter="url(#${id}-ink)" opacity="0.88"><g${tilt}>${body}</g></g>`,
    `</svg>`,
  ].join("");
}
