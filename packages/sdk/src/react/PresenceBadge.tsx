import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import type { ShowmarkClient, ShowmarkError } from "@showmark/sdk";
import type { Address } from "viem";
import { toShowmarkError } from "./copy";

export type PresenceBadgeState = "loading" | "attended" | "absent" | "error";

export interface PresenceBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "onError"> {
  /** Any object with hasAttended, usually a ShowmarkClient. */
  client: Pick<ShowmarkClient, "hasAttended">;
  eventId: bigint;
  /** A pass or the wallet linked to it. */
  account: Address;
  labels?: Partial<Record<PresenceBadgeState, string>>;
  onError?: (error: ShowmarkError) => void;
  /** Replaces the text. Receives the current state. */
  children?: (state: PresenceBadgeState) => ReactNode;
}

const DEFAULT_LABELS: Record<PresenceBadgeState, string> = {
  loading: "Checking presence",
  attended: "Attended",
  absent: "Not checked in",
  error: "Presence unavailable",
};

/** Shows whether an address has a verified presence at an event, read straight from the registry. Unstyled. */
export function PresenceBadge(props: PresenceBadgeProps): ReactNode {
  const { client, eventId, account, labels, onError, children, ...spanProps } = props;
  const [state, setState] = useState<PresenceBadgeState>("loading");
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let current = true;
    setState("loading");
    client.hasAttended(eventId, account).then(
      (attended) => {
        if (current) setState(attended ? "attended" : "absent");
      },
      (error: unknown) => {
        if (!current) return;
        setState("error");
        onErrorRef.current?.(toShowmarkError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [client, eventId, account]);

  return (
    <span {...spanProps} data-state={state} aria-busy={state === "loading"}>
      {children ? children(state) : (labels?.[state] ?? DEFAULT_LABELS[state])}
    </span>
  );
}
