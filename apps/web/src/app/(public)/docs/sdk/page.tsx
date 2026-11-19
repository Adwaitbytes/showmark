import type { Metadata } from "next";
import { SITE } from "@/lib/copy/site";
import { CodeBlock } from "@/ui/CodeBlock";
import { Prose } from "@/ui/Prose";
import { DocPager } from "../DocPager";

export const metadata: Metadata = {
  title: "SDK quickstart",
  description: "Check people in, read presence and gate any QIE contract on real-world attendance with @showmark/sdk.",
};

export default function SdkDoc() {
  return (
    <>
      <Prose>
        <h1>SDK quickstart</h1>
        <p className="lead">
          <code>@showmark/sdk</code> is the TypeScript client and React components behind this app. It signs every
          Showmark message, encodes door codes, reads presence from the chain and talks to the gasless relayer. It runs
          in browsers and in Node with any viem account.
        </p>

        <h2>Install</h2>
        <CodeBlock label="Install command">pnpm add @showmark/sdk viem</CodeBlock>

        <h2>Check someone in</h2>
        <CodeBlock label="Check someone in, TypeScript">
          {`import { ShowmarkClient } from "@showmark/sdk";

const showmark = new ShowmarkClient({
  chain: 1983,
  addresses: { registry },
  relayUrl: "${SITE.appUrl}",
});

// doorPass is the link the phone camera opened, or the bare token
const { txHash } = await showmark.checkIn({ doorPass, signer: passKey });
await showmark.waitForTx(txHash);`}
        </CodeBlock>

        <h2>Read presence</h2>
        <CodeBlock label="Read presence, TypeScript">
          {`await showmark.hasAttended(42n, "0x...");  // true for the pass or its linked wallet
await showmark.presenceOf(42n, "0x...");   // { present, mode, at }
await showmark.streakOf(3n, "0x...");      // { current, best }
await showmark.quote(7n);                  // what one presence pays right now`}
        </CodeBlock>

        <h2>Drop in the React components</h2>
        <CodeBlock label="React components">
          {`import { CheckInButton, DoorQR, PresenceBadge } from "@showmark/sdk/react";

<CheckInButton doorPass={token} account={passKey} relayUrl="${SITE.appUrl}"
  chainId={1983} registry={registry} />
<PresenceBadge client={showmark} eventId={42n} account={address} />
<DoorQR doorKey={doorKey} eventId={42n} chainId={1983} registry={registry}
  origin="${SITE.appUrl}" />`}
        </CodeBlock>
        <p>
          The components ship unstyled, with <code>className</code> hooks, a <code>data-state</code> attribute for CSS
          and accessible markup, so they take on your product&apos;s look.
        </p>

        <h2>Gate a contract on real-world presence</h2>
        <p>
          Any QIE contract can ask whether an account was at an event through the <code>IPresence</code> interface:
        </p>
        <CodeBlock label="Solidity presence gate">
          {`if (!presence.hasAttended(eventId, msg.sender)) revert NotPresent();`}
        </CodeBlock>
        <p>
          The repository includes <code>PresenceGatedMint</code>, a minimal contract that lets an account claim one
          thing per event attended.
        </p>

        <h2>Errors</h2>
        <p>
          Everything the SDK throws is a <code>ShowmarkError</code> with a <code>code</code>: <code>CONFIG</code>,{" "}
          <code>INVALID_INPUT</code>, <code>SIGNING</code>, <code>NETWORK</code>, <code>RELAY</code> (with the
          relayer&apos;s message and next step) or <code>CONTRACT</code> (with the revert name).
        </p>

        <h2>Full reference</h2>
        <p>
          The complete API, the React and Solidity guides, runnable examples and the read-only MCP server setup are in
          the{" "}
          <a href={SITE.sdkReadmeUrl} target="_blank" rel="noopener noreferrer">
            SDK README on GitHub
          </a>
          .
        </p>
      </Prose>
      <DocPager current="sdk" />
    </>
  );
}
