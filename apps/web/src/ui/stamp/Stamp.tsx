import type { CSSProperties } from "react";
import { cn } from "../cn";
import { stampSpec, stampSvg, type StampParams } from "./stampSvg";

export interface StampProps extends Omit<StampParams, "color" | "rotate"> {
  /** Play the 180 ms press on mount. For a press the person triggers, wrap it in <StampPress>. */
  press?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A rubber stamp in the theme's inks. Server-safe: renders the same SVG as stampSvg(), tilted
 * with CSS so the press animation can scale it without losing the tilt. The SVG inside carries
 * role="img" and a full spoken label (event, city, date and proof mode).
 *
 * Size it with width classes (it keeps its aspect ratio): <Stamp className="w-40" ... />
 */
export function Stamp({ press = false, className, style, ...params }: StampProps) {
  const spec = stampSpec(params);
  const svg = stampSvg({ ...params, color: "css", rotate: false });
  const tiltStyle = { "--stamp-rotate": `${spec.rotation}deg`, ...style } as CSSProperties;

  return (
    <span
      className={cn(
        "inline-block select-none [transform:rotate(var(--stamp-rotate))] mix-blend-multiply dark:mix-blend-normal",
        "[&>svg]:block [&>svg]:h-auto [&>svg]:w-full",
        press && "animate-stamp-press",
        className,
      )}
      style={tiltStyle}
      data-shape={spec.shape}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
