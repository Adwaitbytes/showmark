// The React snippets from docs/SDK.md. Type-checked with the package (pnpm typecheck) and exercised in
// test/react.test.tsx; drop them into any React 18 or 19 app.
import { useMemo } from "react";
import type { Address, LocalAccount } from "viem";
import { ShowmarkClient } from "@showmark/sdk";
import { CheckInButton, DoorQR, PresenceBadge } from "@showmark/sdk/react";

const chainId = 1983;
const registry: Address = "0x5157000000000000000000000000000000000001";

/** Attendee screen: the phone camera opened /c/{token}; check in with one tap. */
export function CheckInScreen({ token, passKey, onStamped }: { token: string; passKey: LocalAccount; onStamped: (txHash: string) => void }) {
  return (
    <CheckInButton
      doorPass={token}
      account={passKey}
      relayUrl="https://showmark.app"
      chainId={chainId}
      registry={registry}
      className="button button-primary"
      statusClassName="hint"
      onStateChange={(s) => {
        if (s.phase === "confirmed" && s.txHash) onStamped(s.txHash);
      }}
    />
  );
}

/** Any page: show whether an address was at an event, read from the registry. */
export function Attended({ eventId, account }: { eventId: bigint; account: Address }) {
  const client = useMemo(() => new ShowmarkClient({ chain: chainId, addresses: { registry } }), []);
  return <PresenceBadge client={client} eventId={eventId} account={account} className="badge" />;
}

/** Door screen: a QR that re-signs every 15 seconds with the door key. */
export function DoorScreen({ doorKey, eventId, count }: { doorKey: LocalAccount; eventId: bigint; count: number }) {
  return (
    <DoorQR doorKey={doorKey} eventId={eventId} chainId={chainId} registry={registry} origin="https://showmark.app" size={480} className="door">
      <figcaption>{count} checked in</figcaption>
    </DoorQR>
  );
}
