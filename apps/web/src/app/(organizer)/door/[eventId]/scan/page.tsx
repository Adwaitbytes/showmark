import type { Metadata } from "next";
import { Suspense } from "react";
import { DoorFallback } from "../../../_components/door/DoorFallback";
import { DoorScanner } from "../../../_components/door/DoorScanner";

export const metadata: Metadata = {
  title: "Scan attendee codes",
  robots: { index: false, follow: false },
};

export default function DoorScanPage() {
  return (
    <Suspense fallback={<DoorFallback label="Loading the scanner" />}>
      <DoorScanner />
    </Suspense>
  );
}
