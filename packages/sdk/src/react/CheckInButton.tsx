import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  ShowmarkError,
  buildDoorPassCheckIn,
  relayCheckIn,
  waitForTx,
  type DoorPassPayload,
  type FetchLike,
  type ShowmarkSigner,
} from "@showmark/sdk";
import type { Address, Hex } from "viem";
import { describeError, toShowmarkError } from "./copy";

export type CheckInPhase = "idle" | "signing" | "relaying" | "confirming" | "confirmed" | "failed";

export interface CheckInState {
  phase: CheckInPhase;
  txHash: Hex | null;
  error: ShowmarkError | null;
}

export interface CheckInButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onError" | "children" | "type" | "disabled"> {
  /** The scanned door pass: the decoded payload, the bare token, or the full /c/ URL. */
  doorPass: DoorPassPayload | string;
  /** The attendee's pass key, usually a viem local account kept on the device. */
  account: ShowmarkSigner;
  /** Base URL of a Showmark deployment. The button posts to {relayUrl}/api/relay/check-in. */
  relayUrl: string;
  chainId: number;
  /** ShowmarkRegistry address, the EIP-712 verifying contract. */
  registry: Address;
  /** Poll /api/tx/{hash} until the transaction is mined. Defaults to true. */
  waitForConfirmation?: boolean;
  /** Button text per phase. */
  labels?: Partial<Record<CheckInPhase, string>>;
  /** Class for the polite live region that announces progress. */
  statusClassName?: string;
  /** Disable the button from outside, for example while the camera is still open. */
  disabled?: boolean;
  fetch?: FetchLike;
  onStateChange?: (state: CheckInState) => void;
  /** Replaces the button text. Receives the current state. */
  children?: ReactNode | ((state: CheckInState) => ReactNode);
}

const DEFAULT_LABELS: Record<CheckInPhase, string> = {
  idle: "Check in",
  signing: "Signing",
  relaying: "Sending",
  confirming: "Confirming",
  confirmed: "Checked in",
  failed: "Try again",
};

const STATUS_COPY: Record<Exclude<CheckInPhase, "failed">, string> = {
  idle: "",
  signing: "Signing your check-in on this device.",
  relaying: "Sending your check-in. Showmark pays the gas.",
  confirming: "Sent. Waiting for the QIE chain to confirm.",
  confirmed: "You are checked in.",
};

const IDLE: CheckInState = { phase: "idle", txHash: null, error: null };

function doorPassKey(doorPass: DoorPassPayload | string): string {
  return typeof doorPass === "string" ? doorPass : `${doorPass.eventId}.${doorPass.issuedAt}.${doorPass.doorSig}`;
}

/**
 * One-tap gasless check-in for a scanned door pass. Signs CheckIn with the pass key, sends it to the Showmark
 * relayer, and reports each step through `data-state` and a polite live region. Ships without styles.
 */
export function CheckInButton(props: CheckInButtonProps): ReactNode {
  const {
    doorPass,
    account,
    relayUrl,
    chainId,
    registry,
    waitForConfirmation = true,
    labels,
    statusClassName,
    disabled = false,
    fetch,
    onStateChange,
    children,
    ...buttonProps
  } = props;

  const [state, setState] = useState<CheckInState>(IDLE);
  const busy = state.phase === "signing" || state.phase === "relaying" || state.phase === "confirming";
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });

  const update = useCallback((next: CheckInState) => {
    setState(next);
    onStateChangeRef.current?.(next);
  }, []);

  // A new scan starts over.
  const key = doorPassKey(doorPass);
  useEffect(() => {
    abort.current?.abort();
    inFlight.current = false;
    setState(IDLE);
  }, [key]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    abort.current = controller;
    const relay = { baseUrl: relayUrl, ...(fetch ? { fetch } : {}) };
    let txHash: Hex | null = null;
    try {
      update({ phase: "signing", txHash: null, error: null });
      const data = await buildDoorPassCheckIn({ doorPass, signer: account, chainId, registry });
      if (controller.signal.aborted) return;
      update({ phase: "relaying", txHash: null, error: null });
      txHash = (await relayCheckIn(relay, data)).txHash;
      if (controller.signal.aborted) return;
      if (!waitForConfirmation) {
        update({ phase: "confirmed", txHash, error: null });
        return;
      }
      update({ phase: "confirming", txHash, error: null });
      const receipt = await waitForTx(relay, txHash, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (receipt.status === "reverted") {
        update({
          phase: "failed",
          txHash,
          error: new ShowmarkError("CONTRACT", "The check-in transaction was reverted on chain."),
        });
        return;
      }
      update({ phase: "confirmed", txHash, error: null });
    } catch (error) {
      if (!controller.signal.aborted) update({ phase: "failed", txHash, error: toShowmarkError(error) });
    } finally {
      if (abort.current === controller) inFlight.current = false;
    }
  }, [account, chainId, doorPass, fetch, registry, relayUrl, update, waitForConfirmation]);

  const label = typeof children === "function" ? children(state) : (children ?? labels?.[state.phase] ?? DEFAULT_LABELS[state.phase]);
  const status = state.phase === "failed" ? (state.error ? describeError(state.error) : "") : STATUS_COPY[state.phase];

  return (
    <>
      <button
        {...buttonProps}
        type="button"
        data-state={state.phase}
        aria-busy={busy}
        disabled={disabled || busy || state.phase === "confirmed"}
        onClick={() => void run()}
      >
        {label}
      </button>
      <span role="status" aria-live="polite" className={statusClassName} data-state={state.phase}>
        {status}
      </span>
    </>
  );
}
