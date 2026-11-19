"use client";

import { useEffect, useState } from "react";
import { isAddressEqual, type Address } from "viem";
import { doorKeyValidUntil } from "@/lib/door/rotation";
import { connect, useWallet } from "@/lib/wallet/use-wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { formatDate, formatTime } from "@/ui/format";
import { Notice } from "@/ui/Notice";
import type { RegistryCall } from "../../_lib/tx";
import type { ChainEvent } from "../../_lib/chain";
import { GasLine, TxProgress } from "../TxFeedback";
import { useGasQuote, useRegistryTx } from "../use-registry-tx";

const ARM_DELAY_MS = 1_200;

interface Props {
  eventId: bigint;
  event: ChainEvent;
  eventName: string | null;
  doorKey: Address;
  revoked: boolean;
  /** What this device will do once authorized: show the rotating code, or scan attendee codes. */
  purpose: "show" | "scan";
  onAuthorized(): void;
}

/**
 * First run on a door device: the organizer's wallet signs authorizeDoorKey once, and from then on this browser signs
 * door codes by itself. The key never leaves this device.
 */
export function AuthorizeDoor({ eventId, event, eventName, doorKey, revoked, purpose, onAuthorized }: Props) {
  const wallet = useWallet();
  const account = wallet.status === "connected" ? wallet.account : null;
  const isOrganizer = account !== null && isAddressEqual(account, event.organizer);
  const validUntil = doorKeyValidUntil(event.endsAt);
  const call: RegistryCall = { functionName: "authorizeDoorKey", args: [eventId, doorKey, validUntil] };
  const quote = useGasQuote(isOrganizer ? `authorize:${eventId}:${doorKey}` : null, call, account);
  const tx = useRegistryTx();

  // The Connect button and the Authorize button sit in the same place. When the wallet connects, the button that was
  // just tapped would become Authorize under the same finger, so it stays disabled for a moment and until the gas
  // quote is in: authorizing always takes a second, deliberate tap.
  const [seenAccount, setSeenAccount] = useState<string | null>(account);
  const [armed, setArmed] = useState(account !== null);
  if (account !== seenAccount) {
    setSeenAccount(account);
    setArmed(false);
  }
  useEffect(() => {
    if (armed || account === null) return;
    const id = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(id);
  }, [armed, account]);
  const ready = armed && quote.kind === "ready" && quote.quote.enough;

  async function authorize() {
    if (!account) return;
    const receipt = await tx.run(call, account);
    if (receipt) onAuthorized();
  }

  const until = new Date(Number(validUntil) * 1000).toISOString();

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink-soft">Door screen setup</p>
        <h1 className="font-display text-3xl text-balance text-ink sm:text-4xl">
          {revoked ? "This door key was revoked" : purpose === "scan" ? "Make this device the door scanner" : "Make this device the door"}
        </h1>
        <p className="text-md text-ink-soft">
          {revoked
            ? "The organizer revoked the key this device was using, so its codes no longer check anyone in. Authorize it again to keep using this device at the door."
            : `This browser just made a door key for ${eventName ?? `event ${eventId}`}. Approve it once with the organizer’s QIE Wallet and ${
                purpose === "scan"
                  ? "this device will scan each attendee’s code and sign their check-in, even without internet"
                  : "this device will show a fresh signed code every 15 seconds"
              }, with no more wallet popups.`}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-doc bg-paper-deep px-4 py-4 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-soft">Door key on this device</dt>
        <dd className="min-w-0">
          <AddressChip address={doorKey} copy={false} />
        </dd>
        <dt className="text-ink-soft">Organizer wallet</dt>
        <dd className="min-w-0">
          <AddressChip address={event.organizer} copy={false} />
        </dd>
        <dt className="text-ink-soft">Key works until</dt>
        <dd>
          {formatDate(until)}, {formatTime(until)}, one hour after the event ends
        </dd>
      </dl>

      {account === null ? (
        <div className="flex flex-col gap-3">
          <Button variant="secondary" size="lg" onClick={() => void connect()} pending={wallet.status === "connecting"}>
            Connect the organizer’s QIE Wallet
          </Button>
          {wallet.error ? (
            <Notice tone="danger" title={wallet.error.message}>
              {wallet.error.action}
            </Notice>
          ) : null}
          <p className="text-sm text-ink-soft">
            Setting up the door on a tablet without a wallet? Open this page once on a laptop with QIE Wallet instead. The key belongs to this browser, so use the same device at the door.
          </p>
        </div>
      ) : !isOrganizer ? (
        <Notice tone="warning" title="This wallet did not create the event">
          Only the organizer can authorize a door. Switch QIE Wallet to the account that created event {eventId.toString()}, which ends in{" "}
          <span className="font-mono">{event.organizer.slice(-4)}</span>, then reload this page.
        </Notice>
      ) : (
        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={() => void authorize()}
            pending={tx.busy}
            disabled={!ready}
            data-testid="authorize-door"
          >
            {revoked ? "Authorize this device again" : "Authorize this device"}
          </Button>
          {!armed ? (
            <p className="text-sm text-ink-soft" aria-live="polite">
              Wallet connected. Check the details above, then authorize.
            </p>
          ) : null}
          {tx.phase.kind === "idle" ? <GasLine quote={quote} account={account} /> : null}
          <TxProgress phase={tx.phase} account={account} doneTitle="This device is now the door" />
        </div>
      )}
    </div>
  );
}
