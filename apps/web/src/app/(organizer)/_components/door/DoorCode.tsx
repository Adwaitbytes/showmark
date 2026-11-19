import { ROTATION_MS } from "@/lib/door/rotation";
import { cn } from "@/ui/cn";

interface Props {
  /** QR markup from doorQrSvg, or null while the first code is on its way. */
  svg: string | null;
  /** Changes with every new code so the new one fades in. */
  codeKey: number | string | null;
  /** Unix seconds of the code shown, for tests and the screen reader label; never the link itself. */
  issuedAt: string;
  msLeft: number;
  /** Replaces the countdown line, for example when a new code could not be made. */
  status: string | null;
  className?: string;
}

/**
 * The door code as a printed object: registration corners, a quiet zone that stays light in both themes, and a
 * countdown ring to the next code. Shared by the door screen and the judges' desk.
 */
export function DoorCode({ svg, codeKey, issuedAt, msLeft, status, className }: Props) {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  const progress = Math.min(1, Math.max(0, msLeft / ROTATION_MS));
  return (
    <figure className={cn("flex flex-col items-center gap-[2.2vmin]", className)}>
      <div className="relative w-full">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="absolute top-0 left-0 size-[6%] border-t-[3px] border-l-[3px] border-ink" />
          <span className="absolute top-0 right-0 size-[6%] border-t-[3px] border-r-[3px] border-ink" />
          <span className="absolute bottom-0 left-0 size-[6%] border-b-[3px] border-l-[3px] border-ink" />
          <span className="absolute right-0 bottom-0 size-[6%] border-r-[3px] border-b-[3px] border-ink" />
        </span>
        <div className="p-[3.5%]">
          <div
            role="img"
            aria-label="Door check-in code. Point your phone camera at it to check in."
            data-testid="door-qr"
            data-issued-at={issuedAt}
            className="grid aspect-square w-full place-items-center rounded-doc bg-[#faf7f0] p-[7%] shadow-sheet [&_svg]:size-full"
          >
            {svg ? (
              <div
                key={codeKey ?? "code"}
                className="size-full animate-[door-code-in_260ms_var(--ease-out-quart)_both]"
                // Generated locally by the qrcode library from a URL we built; it contains no user input.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <span className="size-full animate-ink-wait rounded-doc bg-paper-deep" />
            )}
          </div>
        </div>
      </div>
      <figcaption className="flex items-center gap-[1.4vmin] text-ink-soft">
        <CountdownRing progress={progress} />
        <span className="text-[clamp(1rem,2.1vmin,1.5rem)]" aria-live="off">
          {status ?? `New code in ${seconds} s`}
        </span>
      </figcaption>
    </figure>
  );
}

function CountdownRing({ progress }: { progress: number }) {
  const r = 15;
  const circumference = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="size-[clamp(1.75rem,3.6vmin,2.75rem)] -rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--rule-soft)" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--vermilion)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        className="transition-[stroke-dashoffset] duration-200 ease-linear"
      />
    </svg>
  );
}
