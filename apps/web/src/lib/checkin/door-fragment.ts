"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { decodeDoorPass, type DoorPassPayload } from "@/lib/qr/payload";

// The door QR is /c/{token}#{ticketKey}. Browsers never send the fragment to a server (audit N-03),
// so the ticket key exists only on the phone that scanned the code. This reads it once, keeps it in
// memory for this page (never in storage), and clears it from the address bar so it does not sit in
// history or get shared by "copy link".

let captured: { path: string; fragment: string } | null = null;

function readFragment(): string {
  const { pathname, hash } = window.location;
  if (hash.length > 1) {
    captured = { path: pathname, fragment: hash.slice(1) };
    return captured.fragment;
  }
  // The address bar was already cleaned: the fragment read earlier for this path still counts.
  return captured?.path === pathname ? captured.fragment : "";
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export type DoorCode =
  /** Server render and hydration: the fragment is not known yet, so show the starting state. */
  | { status: "reading" }
  | { status: "ok"; door: DoorPassPayload }
  /** A well-formed door token with no ticket key after it: the link lost its fragment. */
  | { status: "missing-key" }
  | { status: "invalid" };

const TOKEN = /^\d{1,20}\.\d{1,20}\.[A-Za-z0-9_-]+$/;

/** Pure decision, exported for tests: what a token plus fragment amounts to. */
export function classifyDoorCode(token: string, fragment: string | null): DoorCode {
  if (fragment === null) return { status: "reading" };
  if (fragment === "") return TOKEN.test(token) ? { status: "missing-key" } : { status: "invalid" };
  const door = decodeDoorPass(`${token}#${fragment}`);
  return door ? { status: "ok", door } : { status: "invalid" };
}

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The door code for `/c/[token]`, combining the path token with the fragment read on the phone. */
export function useDoorCode(rawToken: string): DoorCode {
  const fragment = useSyncExternalStore(subscribe, readFragment, () => null);
  const code = useMemo(() => classifyDoorCode(decodeSegment(rawToken), fragment), [rawToken, fragment]);

  useEffect(() => {
    if (fragment === null || window.location.hash.length <= 1) return;
    // Keep Next's router state; only the fragment goes.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, [fragment]);

  return code;
}
