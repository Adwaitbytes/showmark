import type { CSSProperties } from "react";
import { cn } from "../cn";
import { markSpec, markSvg, type MarkParams } from "./stampSvg";

export interface RubberMarkProps extends Omit<MarkParams, "color" | "rotate"> {
  press?: boolean;
  className?: string;
}

/**
 * A framed office mark struck over a document, for states rather than events:
 * <RubberMark lines={["Awaiting", "first check-in"]} seed="traction" className="w-64" />
 */
export function RubberMark({ press = false, className, ...params }: RubberMarkProps) {
  const spec = markSpec(params);
  return (
    <span
      className={cn(
        "inline-block select-none [transform:rotate(var(--stamp-rotate))] mix-blend-multiply dark:mix-blend-normal",
        "[&>svg]:block [&>svg]:h-auto [&>svg]:w-full",
        press && "animate-stamp-press",
        className,
      )}
      style={{ "--stamp-rotate": `${spec.rotation}deg` } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: markSvg({ ...params, color: "css", rotate: false }) }}
    />
  );
}
