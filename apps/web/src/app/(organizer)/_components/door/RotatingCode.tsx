"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import type { Address, LocalAccount } from "viem";
import type { ChainClock } from "@/lib/door/clock";
import { issuedAtFor, msUntilNextRotation, ROTATION_MS, rotationStart } from "@/lib/door/rotation";
import { signDoorPass } from "@/lib/door/sign";
import { doorPassUrl } from "@/lib/qr/payload";
import { DoorCode } from "./DoorCode";

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
  issuedAt: bigint;
}

/** Renders a door link as QR markup. Low error correction keeps the modules large for cameras at a distance. */
export function doorQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "L", color: { dark: "#141311", light: "#00000000" } });
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
        // The link holds this rotation's ticket key, so it exists only inside the QR: never in the DOM, storage or logs.
        // Low error correction keeps the modules large, which is what matters for a camera at the back of a hall. With
        // the ticket key the link is about 170 characters, a version 8 code (49 modules); on a 1080p projector that is
        // still about 13 pixels per module, and the code decodes from a quarter-size capture of the screen.
        const svg = await doorQrSvg(url);
        if (!cancelled) {
          setCode({ slot, svg, issuedAt });
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
      // A signature still in flight belongs to this run; let the next run sign the current slot itself.
      signingSlot.current = null;
    };
  }, [doorKey, eventId, registry, clock]);

  return (
    <DoorCode
      svg={code?.svg ?? null}
      codeKey={code?.slot ?? null}
      issuedAt={code?.issuedAt.toString() ?? ""}
      msLeft={msLeft}
      status={failed ? "Could not make a new code. Trying again." : null}
      className={className}
    />
  );
}
