import { cn } from "../cn";
import { createRng, hashSeed, r1, type Rng } from "../seed";

/**
 * Guilloche: the engraved, interlaced line work on banknotes and passports.
 *
 * Every pattern is generated from a seed (a wallet or pass address), so each passport carries
 * a pattern no other holder has. Each layer is one closed curve drawn once and repeated with
 * small rotations or offsets through <use>, which is how real guilloche engines build the woven
 * look, and keeps the markup to a few kilobytes.
 */

export type GuillocheVariant = "rosette" | "band";

type InkRole = "stamp-blue" | "ledger-green" | "vermilion" | "ink";

interface Layer {
  id: string;
  d: string;
  ink: InkRole;
  opacity: number;
  width: number;
  transforms: string[];
}

export interface GuillocheGeometry {
  viewBox: string;
  layers: Layer[];
}

const INK_PAIRS: readonly [readonly [InkRole, InkRole], ...(readonly [InkRole, InkRole])[]] = [
  ["stamp-blue", "ledger-green"],
  ["stamp-blue", "vermilion"],
  ["ledger-green", "ink"],
  ["stamp-blue", "ink"],
  ["ledger-green", "vermilion"],
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function polarPath(points: number, radiusAt: (theta: number) => number, cx: number, cy: number): string {
  const parts: string[] = [];
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const r = radiusAt(theta);
    parts.push(`${r1(cx + r * Math.cos(theta))} ${r1(cy + r * Math.sin(theta))}`);
  }
  return `M${parts.join("L")}Z`;
}

function hypotrochoidPath(rng: Rng, cx: number, cy: number, maxRadius: number, detail: number): {
  d: string;
  petals: number;
} {
  const petals = rng.int(7, 17);
  let loops = rng.int(2, 5);
  while (gcd(petals, loops) !== 1) loops += 1;
  const R = 1;
  const r = (R * loops) / petals;
  const d = r * rng.range(0.75, 1.45);
  const scale = maxRadius / (R - r + d);
  const steps = loops * detail;
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2 * loops;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    parts.push(`${r1(cx + x * scale)} ${r1(cy + y * scale)}`);
  }
  return { d: `M${parts.join("L")}Z`, petals };
}

function rotations(count: number, spreadDegrees: number, cx: number, cy: number): string[] {
  return Array.from({ length: count }, (_, i) => `rotate(${r1((i * spreadDegrees) / count)} ${cx} ${cy})`);
}

function rosette(seed: string, detail: number): GuillocheGeometry {
  const rng = createRng(`rosette:${seed}`);
  const [primary, secondary] = rng.pick(INK_PAIRS);
  const c = 200;
  const key = hashSeed(seed).toString(36);

  // Outer woven ring: a lobed circle with a slow wobble, repeated across one lobe period.
  const lobes = rng.int(9, 19);
  const wobble = rng.int(3, 6);
  const amp = rng.range(11, 17);
  const wobbleAmp = rng.range(4, 9);
  const wobblePhase = rng.range(0, Math.PI * 2);
  const ring = polarPath(
    detail * 3,
    (t) => 152 + amp * Math.sin(lobes * t) + wobbleAmp * Math.sin(wobble * t + wobblePhase),
    c,
    c,
  );
  const ringCopies = rng.int(12, 18);

  // Inner rosette: a hypotrochoid, three copies a third of a petal apart for the moiré.
  const hypo = hypotrochoidPath(rng, c, c, rng.range(92, 112), detail);

  // Centre medallion: a small lobed ring.
  const coreLobes = rng.int(5, 11);
  const core = polarPath(detail, (t) => 30 + 6 * Math.sin(coreLobes * t), c, c);

  return {
    viewBox: "0 0 400 400",
    layers: [
      {
        id: `gq-${key}-ring`,
        d: ring,
        ink: primary,
        opacity: 0.62,
        width: 0.55,
        transforms: rotations(ringCopies, 360 / lobes, c, c),
      },
      {
        id: `gq-${key}-hypo`,
        d: hypo.d,
        ink: secondary,
        opacity: 0.5,
        width: 0.5,
        transforms: rotations(3, 360 / hypo.petals, c, c),
      },
      {
        id: `gq-${key}-core`,
        d: core,
        ink: primary,
        opacity: 0.7,
        width: 0.6,
        transforms: rotations(6, 360 / coreLobes, c, c),
      },
    ],
  };
}

function band(seed: string, detail: number): GuillocheGeometry {
  const rng = createRng(`band:${seed}`);
  const [primary, secondary] = rng.pick(INK_PAIRS);
  const width = 960;
  const height = 96;
  const mid = height / 2;
  const key = hashSeed(seed).toString(36);

  const wavelength = rng.range(84, 150);
  const slowWavelength = wavelength * rng.pick([2.5, 3, 3.5, 4] as const);
  const amp = rng.range(18, 25);
  const slowAmp = rng.range(5, 10);
  const phase = rng.range(0, Math.PI * 2);
  const step = Math.max(1.5, 960 / (detail * 3));
  const parts: string[] = [];
  for (let x = -wavelength; x <= width + wavelength; x += step) {
    const y =
      mid +
      amp * Math.sin((2 * Math.PI * x) / wavelength) +
      slowAmp * Math.sin((2 * Math.PI * x) / slowWavelength + phase);
    parts.push(`${r1(x)} ${r1(y)}`);
  }
  const wave = `M${parts.join("L")}`;
  const copies = rng.int(8, 13);
  const shift = (i: number) => r1((i * wavelength) / copies);

  return {
    viewBox: `0 0 ${width} ${height}`,
    layers: [
      {
        id: `gb-${key}-wave`,
        d: wave,
        ink: primary,
        opacity: 0.6,
        width: 0.55,
        transforms: Array.from({ length: copies }, (_, i) => `translate(${shift(i)} 0)`),
      },
      {
        id: `gb-${key}-mirror`,
        d: wave,
        ink: secondary,
        opacity: 0.42,
        width: 0.5,
        transforms: Array.from(
          { length: Math.max(4, Math.floor(copies / 2)) },
          (_, i) => `translate(${shift(i * 2) + r1(wavelength / 2)} ${height}) scale(1 -1)`,
        ),
      },
    ],
  };
}

/** Pure geometry for a seed. Exported for tests and for any non-React renderer. */
export function guillocheGeometry(seed: string, variant: GuillocheVariant, detail = 240): GuillocheGeometry {
  return variant === "rosette" ? rosette(seed, detail) : band(seed, detail);
}

export interface GuillocheProps {
  /** Wallet or pass address. Any string works; the same string always draws the same pattern. */
  seed: string;
  variant?: GuillocheVariant;
  /** Points per revolution. Lower it for small renders. */
  detail?: number;
  className?: string;
  /** When set, the pattern is announced as an image with this label. Otherwise it is decorative. */
  label?: string;
}

export function Guilloche({ seed, variant = "rosette", detail, className, label }: GuillocheProps) {
  const geometry = guillocheGeometry(seed, variant, detail);
  const layerIds = geometry.layers.map((layer) => layer.id);
  // Two layers can share geometry (the band's mirror), so only define each id once.
  const defs = geometry.layers.filter((layer, index) => layerIds.indexOf(layer.id) === index);

  return (
    <svg
      viewBox={geometry.viewBox}
      preserveAspectRatio={variant === "band" ? "xMidYMid slice" : "xMidYMid meet"}
      className={cn("block", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        {defs.map((layer) => (
          <path key={layer.id} id={layer.id} d={layer.d} vectorEffect="non-scaling-stroke" />
        ))}
      </defs>
      {geometry.layers.map((layer, layerIndex) => (
        <g
          key={`${layer.id}-${layerIndex}`}
          fill="none"
          stroke={`var(--${layer.ink})`}
          strokeOpacity={layer.opacity}
          strokeWidth={layer.width}
          strokeLinejoin="round"
        >
          {layer.transforms.map((transform) => (
            <use key={transform} href={`#${layer.id}`} transform={transform} />
          ))}
        </g>
      ))}
    </svg>
  );
}
