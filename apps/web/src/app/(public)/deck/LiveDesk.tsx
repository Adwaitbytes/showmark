"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { doorQrSvg } from "@/app/(organizer)/_components/door/RotatingCode";
import { DoorCode } from "@/app/(organizer)/_components/door/DoorCode";
import "@/app/(organizer)/_components/door/door.css";
import { ROTATION_MS } from "@/lib/door/rotation";
import { formatCount } from "@/ui/format";

const passSchema = z.object({ url: z.string().url(), issuedAt: z.string(), expiresAt: z.string() });
const eventSchema = z.object({ checkedIn: z.number().int().nonnegative() });
const errorSchema = z.object({ error: z.object({ message: z.string(), action: z.string() }) });

interface Code {
  svg: string;
  issuedAt: string;
  expiresAt: number;
  receivedAt: number;
}

/**
 * The real judges' desk code, fetched from /api/judges-desk/pass every 15 seconds (the server
 * signs a fresh pass each time), with the desk's live check-in count beside it.
 */
export function LiveDesk({ eventId }: { eventId: string }) {
  const [code, setCode] = useState<Code | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const fetchPass = useCallback(async () => {
    try {
      const response = await fetch("/api/judges-desk/pass", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        setProblem(parsed.success ? `${parsed.data.error.message} ${parsed.data.error.action}` : "The desk code could not be made. Trying again.");
        return;
      }
      const pass = passSchema.parse(body);
      const svg = await doorQrSvg(pass.url);
      const receivedAt = Date.now();
      setNow(receivedAt);
      setCode({ svg, issuedAt: String(Math.floor(Date.parse(pass.issuedAt) / 1000)), expiresAt: Date.parse(pass.expiresAt), receivedAt });
      setProblem(null);
    } catch {
      setProblem("The desk code could not be reached. Trying again.");
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const loop = async () => {
      await fetchPass();
      if (!cancelled) timer = setTimeout(() => void loop(), ROTATION_MS);
    };
    void loop();
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
    };
  }, [fetchPass]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(`/api/events/${eventId}`, { cache: "no-store" });
        if (!response.ok) return;
        const parsed = eventSchema.safeParse(await response.json());
        if (parsed.success && !cancelled) setCount(parsed.data.checkedIn);
      } catch {
        // The count is a nicety beside the code; the next poll tries again.
      }
    };
    void read();
    const poll = setInterval(() => void read(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [eventId]);

  const usable = code !== null && now < code.expiresAt;
  const msLeft = code ? Math.max(0, ROTATION_MS - (now - code.receivedAt)) : ROTATION_MS;

  return (
    <div className="flex w-full flex-col items-center gap-[2vh]">
      <DoorCode
        svg={usable ? code.svg : null}
        codeKey={code?.receivedAt ?? null}
        issuedAt={code?.issuedAt ?? "0"}
        msLeft={msLeft}
        status={problem}
        className="w-full max-w-[min(62vh,34rem)]"
      />
      <p className="text-center font-display text-[clamp(1.5rem,2.4vw,3rem)] leading-tight text-ink">
        Scan with your phone camera to check in
      </p>
      <p className="text-center text-[clamp(1rem,1.3vw,1.6rem)] text-ink-soft" aria-live="polite">
        {count === null ? "Reading the live count" : (
          <>
            <span className="font-mono text-ink">{formatCount(count)}</span> checked in so far
          </>
        )}
      </p>
    </div>
  );
}
