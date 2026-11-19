"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import type { Address, LocalAccount } from "viem";
import type { ChainClock } from "@/lib/door/clock";
import { issuedAtFor, msUntilNextRotation, ROTATION_MS, rotationStart } from "@/lib/door/rotation";
import { signDoorPass } from "@/lib/door/sign";
import { doorPassUrl } from "@/lib/qr/payload";
import { cn } from "@/ui/cn";

interface Props {
  doorKey: LocalAccount;
  eventId: bigint;
  registry: Address;
  clock: ChainClock;
  className?: string;
}

interface Code {
  slot: number;
  svg: string;
  url: string;
  issuedAt: bigint;
}

const TICK_MS = 200;

/**
 * The rotating door code. Every 15 seconds of chain time it signs a fresh DoorPass with the door key and draws it as
 * a QR code that is a plain link, so any phone camera opens it. Signing needs no network, so the code keeps rotating
 * even when the venue Wi-Fi drops.
 */
export function RotatingCode({ doorKey, eventId, registry, clock, className }: Props) {
  const [code, setCode] = useState<Code | null>(null);
  const [msLeft, setMsLeft] = useState(ROTATION_MS);
  const [failed, setFailed] = useState(false);
  const signingSlot = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const now = clock.nowMs();
      setMsLeft(msUntilNextRotation(now));
      const slot = rotationStart(now);
      if (signingSlot.current === slot) return;
      signingSlot.current = slot;
      try {
        const issuedAt = issuedAtFor(now);
        const pass = await signDoorPass(doorKey, eventId, issuedAt, registry);
        const url = doorPassUrl(window.location.origin, pass);
        // Low error correction keeps the modules large, which is what matters for a camera at the back of a hall.
        const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "L", color: { dark: "#141311", light: "#00000000" } });
        if (!cancelled) {
          setCode({ slot, svg, url, issuedAt });
          setFailed(false);
        }
      } catch {
        // Try again on the next tick rather than leave an old code on screen.
        signingSlot.current = null;
        if (!cancelled) setFailed(true);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [doorKey, eventId, registry, clock]);

  const seconds = Math.ceil(msLeft / 1000);
  const progress = msLeft / ROTATION_MS;

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
            data-issued-at={code?.issuedAt.toString() ?? ""}
            data-url={code?.url ?? ""}
            className="grid aspect-square w-full place-items-center rounded-doc bg-[#faf7f0] p-[7%] shadow-sheet [&_svg]:size-full"
          >
            {code ? (
              <div
                key={code.slot}
                className="size-full animate-[door-code-in_260ms_var(--ease-out-quart)_both]"
                // The SVG is generated locally by the qrcode library from our own URL; it contains no user input.
                dangerouslySetInnerHTML={{ __html: code.svg }}
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
          {failed ? "Could not make a new code. Trying again." : `New code in ${seconds} s`}
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
