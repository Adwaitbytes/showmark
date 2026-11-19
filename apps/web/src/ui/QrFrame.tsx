import type { ReactNode } from "react";
import { cn } from "./cn";

export interface QrFrameProps {
  /** The QR itself (an <svg> or <canvas>). Draw modules in currentColor; the frame keeps them dark on light. */
  children: ReactNode;
  /** One line under the code telling people what to do: "Scan with your phone camera". */
  caption?: ReactNode;
  /** Small status under the caption, for example "New code in 12 s". */
  status?: ReactNode;
  /** Spoken description of the code. */
  label: string;
  className?: string;
}

function CornerMarks() {
  const corner = "absolute size-6 border-ink";
  return (
    <span aria-hidden="true">
      <span className={cn(corner, "top-0 left-0 border-t-[3px] border-l-[3px]")} />
      <span className={cn(corner, "top-0 right-0 border-t-[3px] border-r-[3px]")} />
      <span className={cn(corner, "bottom-0 left-0 border-b-[3px] border-l-[3px]")} />
      <span className={cn(corner, "right-0 bottom-0 border-r-[3px] border-b-[3px]")} />
    </span>
  );
}

/**
 * A frame for door codes and attendee codes: registration corners and a quiet zone. The code
 * area is always near-black on near-white, even on the night desk, because many phone cameras
 * fail on inverted codes.
 */
export function QrFrame({ children, caption, status, label, className }: QrFrameProps) {
  return (
    <figure className={cn("flex flex-col items-center gap-4", className)}>
      <div className="relative w-full p-3">
        <CornerMarks />
        <div
          role="img"
          aria-label={label}
          className="grid aspect-square w-full place-items-center rounded-doc bg-[#faf7f0] p-[6%] text-[#141311] [&_canvas]:size-full [&_svg]:size-full"
        >
          {children}
        </div>
      </div>
      {caption || status ? (
        <figcaption className="flex flex-col items-center gap-1 text-center">
          {caption ? <span className="text-md font-medium text-ink">{caption}</span> : null}
          {status ? <span className="text-sm text-ink-soft">{status}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
