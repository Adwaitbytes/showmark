"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Button } from "./Button";
import { ErrorState } from "./ErrorState";
import { RetryIcon } from "./icons";

interface SectionBoundaryProps {
  /** What failed to load, said as a result: "The live numbers did not load". */
  title: string;
  /** What to do next. Defaults to trying again. */
  hint?: string;
}

function SectionError({ title, hint }: SectionBoundaryProps, { error, retry }: ErrorInfo) {
  const reference = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
  return (
    <ErrorState
      title={title}
      reference={reference}
      action={
        <Button variant="quiet" onClick={() => retry()} leading={<RetryIcon className="size-4" />}>
          Try again
        </Button>
      }
    >
      {hint ?? "This part of the page could not be read just now. The rest of the page still works. Try again in a moment."}
    </ErrorState>
  );
}

/**
 * Contains a failure to one section so the rest of the page keeps working. Wrap server data
 * sections in it, outside their <Suspense>:
 *
 *   <SectionBoundary title="The live numbers did not load">
 *     <Suspense fallback={<LedgerSkeleton />}><LiveLedger /></Suspense>
 *   </SectionBoundary>
 */
export const SectionBoundary = catchError(SectionError);
