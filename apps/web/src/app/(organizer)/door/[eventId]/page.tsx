import type { Metadata } from "next";
import { Suspense } from "react";
import { DoorFallback } from "../../_components/door/DoorFallback";
import { DoorScreen } from "../../_components/door/DoorScreen";

export const metadata: Metadata = {
  title: "Door screen",
  robots: { index: false, follow: false },
};

export default function DoorPage() {
  return (
    <Suspense fallback={<DoorFallback label="Loading the door screen" />}>
      <DoorScreen />
    </Suspense>
  );
}
