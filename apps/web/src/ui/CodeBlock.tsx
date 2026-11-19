import type { ReactNode } from "react";

/**
 * A code sample inside <Prose>. Long lines scroll sideways, so the block is a labelled, focusable
 * region: keyboard users can reach it and scroll it with the arrow keys.
 */
export function CodeBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <pre tabIndex={0} role="region" aria-label={label}>
      {children}
    </pre>
  );
}
