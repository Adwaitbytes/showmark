"use client";

import { useEffect, useRef, useState } from "react";
import { isAddressEqual, type Address } from "viem";
import { DoorQueue } from "@/lib/door/queue";
import { IndexedDbQueueStore, indexedDbAvailable } from "@/lib/door/idb";
import { connect, useWallet } from "@/lib/wallet/use-wallet";
import { Button } from "@/ui/Button";
import { CloseIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { TxProgress } from "../TxFeedback";
import { useRegistryTx } from "../use-registry-tx";

interface Props {
  eventId: bigint;
  organizer: Address;
  doorKey: Address;
  open: boolean;
  onClose(): void;
  /** Called after the key is forgotten on this device. */
  onReleased(): void;
}

async function pendingScans(eventId: bigint): Promise<number> {
  if (!indexedDbAvailable()) return 0;
  try {
    return (await new DoorQueue(new IndexedDbQueueStore()).summary(eventId.toString())).pending;
  } catch {
    return 0;
  }
}

/**
 * Door device settings: revoke the key on-chain (needs the organizer's wallet) and "this device is not the door
 * anymore" (forgets the key here). Scans still waiting in the offline queue block the reset until confirmed twice,
 * because forgetting the key does not delete them but nobody would come back to send them.
 */
export function DoorSettings({ eventId, organizer, doorKey, open, onClose, onReleased }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const wallet = useWallet();
  const tx = useRegistryTx();
  const [pending, setPending] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      void pendingScans(eventId).then(setPending);
    }
    if (!open && el.open) el.close();
  }, [open, eventId]);

  const account = wallet.status === "connected" ? wallet.account : null;
  const isOrganizer = account !== null && isAddressEqual(account, organizer);

  async function revoke() {
    if (!account) return;
    const receipt = await tx.run({ functionName: "revokeDoorKey", args: [eventId, doorKey] }, account);
    if (receipt) onReleased();
  }

  function reset() {
    if (pending > 0 && !confirmReset) {
      setConfirmReset(true);
      return;
    }
    onReleased();
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="door-settings-title"
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-doc bg-sheet p-0 text-ink shadow-lift backdrop:bg-[rgb(18_17_15/0.55)]"
    >
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h2 id="door-settings-title" className="font-display text-2xl">
            Door settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mt-1 -mr-2 inline-grid size-11 place-items-center rounded-doc text-ink-soft hover:bg-paper-deep hover:text-ink"
            aria-label="Close door settings"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        <section aria-labelledby="revoke-title" className="flex flex-col gap-3">
          <h3 id="revoke-title" className="text-md font-medium">
            Revoke this door key
          </h3>
          <p className="text-base text-ink-soft">
            Stops the codes from this device being accepted, on the chain, for good. Use it if this device was lost or someone else had it. It needs the organizer’s wallet and a small gas fee.
          </p>
          {account === null ? (
            <Button onClick={() => void connect()} pending={wallet.status === "connecting"}>
              Connect the organizer’s QIE Wallet
            </Button>
          ) : !isOrganizer ? (
            <Notice tone="warning" title="This wallet is not the organizer">
              Switch QIE Wallet to the account that created the event, then try again.
            </Notice>
          ) : (
            <Button variant="secondary" onClick={() => void revoke()} pending={tx.busy}>
              Revoke the key and reset this device
            </Button>
          )}
          <TxProgress phase={tx.phase} account={account} doneTitle="The door key is revoked" />
        </section>

        <hr className="border-rule-soft" />

        <section aria-labelledby="reset-title" className="flex flex-col gap-3">
          <h3 id="reset-title" className="text-md font-medium">
            This device is not the door anymore
          </h3>
          <p className="text-base text-ink-soft">
            Forgets the door key in this browser. Nothing changes on the chain, and nobody can use this device to sign codes again. To use it at the door later, authorize a new key.
          </p>
          {confirmReset ? (
            <Notice tone="danger" title={`${pending} scanned check-ins have not been sent yet`}>
              Connect this device to the internet and open the scanner so they can be sent. If you reset now they stay saved here, but nothing will send them.
            </Notice>
          ) : null}
          <Button onClick={reset}>{confirmReset ? "Reset anyway" : "Reset this device"}</Button>
        </section>
      </div>
    </dialog>
  );
}
