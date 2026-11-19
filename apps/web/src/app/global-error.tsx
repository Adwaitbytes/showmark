"use client";

import "./globals.css";

function digestOf(error: unknown): string | undefined {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") return error.digest;
  return undefined;
}

/** Replaces the root layout when it fails, so it brings its own document and keeps to system fonts. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const reference = digestOf(error);
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center px-4 py-16">
        <title>Showmark could not load</title>
        <main id="main" className="w-full max-w-xl rounded-doc bg-sheet px-6 py-10 shadow-sheet sm:px-10">
          <p className="text-sm font-medium text-ink-soft">Showmark</p>
          <h1 className="mt-2 font-display text-3xl text-ink">Showmark could not load</h1>
          <p className="mt-4 text-base text-ink-soft">
            Something went wrong before the page could start. Check-ins and payouts already on chain are not affected.
            Try again in a moment.
          </p>
          {reference ? (
            <p className="mt-3 text-sm text-ink-faint">
              Reference <span className="font-mono">{reference}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-8 inline-flex min-h-11 items-center rounded-doc bg-ink px-5 text-base font-medium text-paper hover:bg-ink-soft"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
