import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import QRCode from "qrcode";
import { createDoorPass, doorPassUrl, type DoorPassPayload, type ShowmarkError, type ShowmarkSigner } from "@showmark/sdk";
import type { Address } from "viem";
import { toShowmarkError } from "./copy";

export type DoorQRState = "loading" | "ready" | "error";

export interface DoorQRProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onError"> {
  /** A door key authorized on-chain for this event. Keep it on the door device only. */
  doorKey: ShowmarkSigner;
  eventId: bigint;
  chainId: number;
  /** ShowmarkRegistry address, the EIP-712 verifying contract. */
  registry: Address;
  /** Origin the QR opens, for example https://showmark.app. The code encodes {origin}/c/{token}. */
  origin: string;
  /** How often to re-sign. Defaults to 15 seconds, the rotation the door screen uses. */
  intervalMs?: number;
  /** Rendered width and height in CSS pixels. Defaults to 320. */
  size?: number;
  /** Quiet zone in QR modules. Defaults to 2. */
  margin?: number;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  alt?: string;
  imgClassName?: string;
  onRotate?: (pass: DoorPassPayload, url: string) => void;
  onError?: (error: ShowmarkError) => void;
  /** Rendered inside the figure after the code, for example a figcaption with the live count. */
  children?: ReactNode;
}

interface Frame {
  src: string;
  issuedAt: bigint;
}

/**
 * The rotating door QR for proof mode 1. Signs DoorPass(eventId, issuedAt) with the door key every 15 seconds
 * and renders it as an SVG QR code that any phone camera opens. Unstyled; size it with `size` or CSS.
 */
export function DoorQR(props: DoorQRProps): ReactNode {
  const {
    doorKey,
    eventId,
    chainId,
    registry,
    origin,
    intervalMs = 15_000,
    size = 320,
    margin = 2,
    errorCorrectionLevel = "M",
    alt,
    imgClassName,
    onRotate,
    onError,
    children,
    ...figureProps
  } = props;

  const [frame, setFrame] = useState<Frame | null>(null);
  const [state, setState] = useState<DoorQRState>("loading");
  const callbacks = useRef({ onRotate, onError });
  callbacks.current = { onRotate, onError };

  useEffect(() => {
    let generation = 0;
    let active = true;

    async function rotate(): Promise<void> {
      const mine = ++generation;
      try {
        const pass = await createDoorPass({ signer: doorKey, chainId, registry, eventId });
        const url = doorPassUrl(origin, pass);
        const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel, margin });
        // A slow signature must never replace a newer code.
        if (!active || mine !== generation) return;
        setFrame({ src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, issuedAt: pass.issuedAt });
        setState("ready");
        callbacks.current.onRotate?.(pass, url);
      } catch (error) {
        if (!active || mine !== generation) return;
        setState("error");
        callbacks.current.onError?.(toShowmarkError(error));
      }
    }

    void rotate();
    const timer = setInterval(() => void rotate(), intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [doorKey, eventId, chainId, registry, origin, intervalMs, errorCorrectionLevel, margin]);

  const seconds = Math.round(intervalMs / 1000);
  return (
    <figure {...figureProps} data-state={state} aria-busy={state === "loading"}>
      {frame ? (
        <img
          src={frame.src}
          width={size}
          height={size}
          className={imgClassName}
          data-issued-at={frame.issuedAt.toString()}
          alt={alt ?? `Check-in code for event ${eventId}. Scan it with a phone camera. It changes every ${seconds} seconds.`}
        />
      ) : null}
      {children}
    </figure>
  );
}
