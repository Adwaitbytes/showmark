import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton, SkeletonStamp, LoadingRegion } from "@/ui/Skeleton";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { AttendeeShell } from "../../_components/AttendeeShell";
import { CheckInScreen } from "./CheckInScreen";

export const metadata: Metadata = {
  title: "Check in",
  // Door codes expire in seconds and carry a signature; nothing here should be indexed.
  robots: { index: false, follow: false },
};

/** Shown for the instant before the door code is read from the URL. */
function CheckInSkeleton() {
  return (
    <LoadingRegion label="Loading" className="mx-auto flex w-full max-w-[32rem] flex-col gap-6 px-4 pt-6 sm:pt-10">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <Sheet>
        <SheetSection className="flex flex-col items-center gap-5 pt-8">
          <SkeletonStamp className="w-48" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-64" />
        </SheetSection>
      </Sheet>
    </LoadingRegion>
  );
}

/**
 * /c/{eventId}.{issuedAt}.{doorSig}: the URL inside the door QR, so any phone camera opens it.
 * The shell is static; the door code is read on the phone, which signs and sends the check-in.
 */
export default function CheckInPage() {
  return (
    <AttendeeShell current="checkin" tabs={false}>
      <Suspense fallback={<CheckInSkeleton />}>
        <CheckInScreen />
      </Suspense>
    </AttendeeShell>
  );
}
