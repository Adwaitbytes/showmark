"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { EventDetail } from "@/lib/api/types";
import { addresses, isDeployed } from "@/lib/chain/addresses";
import { activeChainId } from "@/lib/chain/chains";
import { ChainClock } from "@/lib/door/clock";
import {
  browserStorage,
  ensureDoorKey,
  forgetDoorKey,
  markDoorKeyAuthorized,
  type DoorKeyScope,
  type StoredDoorKey,
} from "@/lib/door/keys";
import { checkInWindow, type CheckInWindow } from "@/lib/door/rotation";
import { api } from "../../_lib/api";
import { readDoorKeyValidUntil, readEvent, readLatestBlockTimestamp, type ChainEvent } from "../../_lib/chain";
import { usePoll } from "../../_lib/use-poll";

/** How often the live count is read from the registry. */
export const COUNT_POLL_MS = 3_000;
const AUTH_POLL_MS = 20_000;
const CLOCK_SAMPLE_MS = 30_000;

export function parseEventId(raw: string | string[] | undefined): bigint | null {
  if (typeof raw !== "string" || !/^[1-9]\d{0,19}$/.test(raw)) return null;
  return BigInt(raw);
}

// ------------------------------------------------------------------------------------------------ online state

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

// ------------------------------------------------------------------------------------------------ chain clock

export interface ClockState {
  clock: ChainClock;
  synced: boolean;
  skewed: boolean;
  offsetMs: number | null;
  /** Set when the latest block could not be read. The clock keeps its last offset. */
  failed: boolean;
}

/** Samples the latest block every 30 seconds so every signed time is chain time, not device time. */
export function useChainClock(enabled: boolean): ClockState {
  const clock = useMemo(() => new ChainClock(), []);
  const [, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sample = async () => {
      try {
        const timestamp = await readLatestBlockTimestamp();
        if (cancelled) return;
        clock.record({ blockTimestamp: timestamp, receivedAtMs: Date.now() });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) {
          setVersion((v) => v + 1);
          timer = setTimeout(sample, CLOCK_SAMPLE_MS);
        }
      }
    };
    void sample();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [clock, enabled]);

  return { clock, synced: clock.synced, skewed: clock.isSkewed(), offsetMs: clock.offsetMs, failed };
}

// ------------------------------------------------------------------------------------------------ door setup

export type DoorPhase =
  | { kind: "not-deployed" }
  | { kind: "invalid-id" }
  | { kind: "loading" }
  | { kind: "load-failed" }
  | { kind: "not-found" }
  | { kind: "no-storage" }
  | { kind: "released" }
  | { kind: "needs-auth"; revoked: boolean }
  | { kind: "ready"; window: CheckInWindow };

export interface DoorSetup {
  eventId: bigint | null;
  phase: DoorPhase;
  event: ChainEvent | null;
  /** Name, venue and city from the API. Null while loading or when the API is unreachable. */
  details: EventDetail | null;
  doorKey: PrivateKeyAccount | null;
  stored: StoredDoorKey | null;
  validUntil: bigint | null;
  clock: ClockState;
  /** True when the last count read failed and the number on screen may be behind. */
  countStale: boolean;
  online: boolean;
  scope: DoorKeyScope | null;
  refreshAuthorization(): void;
  markAuthorized(): void;
  /** "This device is not the door anymore": forgets the key in this browser. */
  release(): void;
  retry(): void;
}

export function useDoorSetup(rawEventId: string | string[] | undefined): DoorSetup {
  const eventId = parseEventId(rawEventId);
  const deployed = isDeployed();
  const online = useOnline();
  const scope = useMemo<DoorKeyScope | null>(
    () => (eventId === null ? null : { chainId: activeChainId, registry: addresses.registry, eventId }),
    [eventId],
  );
  const enabled = deployed && scope !== null;

  const [stored, setStored] = useState<StoredDoorKey | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [released, setReleased] = useState(false);

  // The key lives in browser storage, which only exists after hydration, so it is read in an effect.
  useEffect(() => {
    if (!enabled || !scope || released) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage, an external system
      setStored(ensureDoorKey(browserStorage(), scope));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [enabled, scope, released]);

  const doorKey = useMemo(() => (stored ? privateKeyToAccount(stored.privateKey) : null), [stored]);

  const eventPoll = usePoll(enabled ? `event:${scope?.eventId}` : null, () => readEvent(scope!.eventId), COUNT_POLL_MS);
  const detailsPoll = usePoll(enabled ? `details:${scope?.eventId}` : null, () => api.event(scope!.eventId.toString()), 60_000);
  const authPoll = usePoll(
    enabled && doorKey ? `auth:${scope?.eventId}:${doorKey.address}` : null,
    () => readDoorKeyValidUntil(scope!.eventId, doorKey!.address),
    AUTH_POLL_MS,
  );
  const clock = useChainClock(enabled);

  const validUntil = authPoll.data;
  const event = eventPoll.data ?? null;

  const refreshAuth = authPoll.refresh;
  const markAuthorized = useCallback(() => {
    if (!scope) return;
    markDoorKeyAuthorized(browserStorage(), scope);
    setStored(ensureDoorKey(browserStorage(), scope));
    refreshAuth();
  }, [scope, refreshAuth]);

  const release = useCallback(() => {
    if (!scope) return;
    forgetDoorKey(browserStorage(), scope);
    setStored(null);
    setReleased(true);
  }, [scope]);

  // Re-render every second so the check-in window state follows the chain clock without a reload.
  const [, setSecond] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setSecond((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  let phase: DoorPhase;
  if (!deployed) phase = { kind: "not-deployed" };
  else if (eventId === null) phase = { kind: "invalid-id" };
  else if (released) phase = { kind: "released" };
  else if (storageFailed) phase = { kind: "no-storage" };
  else if (eventPoll.loading) phase = { kind: "loading" };
  else if (event === null && eventPoll.error) phase = { kind: "load-failed" };
  else if (event === null) phase = { kind: "not-found" };
  else if (!doorKey || validUntil === null) phase = authPoll.error && validUntil === null && !authPoll.loading ? { kind: "load-failed" } : { kind: "loading" };
  else if (validUntil === 0n) phase = { kind: "needs-auth", revoked: stored?.authorizedAt !== null && stored?.authorizedAt !== undefined };
  else phase = { kind: "ready", window: checkInWindow(clock.clock.nowSeconds(), event.startsAt, event.endsAt) };

  return {
    eventId,
    phase,
    event,
    details: detailsPoll.data,
    doorKey,
    stored,
    validUntil: validUntil ?? null,
    clock,
    countStale: Boolean(eventPoll.error) && eventPoll.data !== null,
    online,
    scope,
    refreshAuthorization: refreshAuth,
    markAuthorized,
    release,
    retry: () => {
      eventPoll.refresh();
      authPoll.refresh();
    },
  };
}

// ------------------------------------------------------------------------------------------------ device helpers

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** Keeps the screen on while the door is running. Re-acquired when the tab becomes visible again. */
export function useWakeLock(active: boolean): "on" | "unsupported" | "denied" | "off" {
  const [state, setState] = useState<"on" | "unsupported" | "denied" | "off">("off");
  useEffect(() => {
    if (!active) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection that only runs in the browser
      setState("unsupported");
      return;
    }
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        sentinel = await wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        setState("on");
        sentinel.addEventListener("release", () => {
          if (!cancelled) setState("off");
        });
      } catch {
        // Battery saver or a browser policy can refuse it; the banner tells the organizer to turn sleep off by hand.
        if (!cancelled) setState("denied");
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
  return state;
}

function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

export function useFullscreen(): { active: boolean; supported: boolean; toggle(): void } {
  const active = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );
  const supported = useSyncExternalStore(
    subscribeFullscreen,
    () => typeof document.documentElement.requestFullscreen === "function",
    () => false,
  );
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);
  return { active, supported, toggle };
}
