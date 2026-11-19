import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { EventConsole } from "../../_components/EventConsole";

export const metadata: Metadata = {
  title: "Event console",
  robots: { index: false, follow: false },
};

function Fallback() {
  return (
    <Container className="py-12">
      <LoadingRegion label="Loading the event" className="flex flex-col gap-6">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </LoadingRegion>
    </Container>
  );
}

export default function EventConsolePage() {
  return (
    <PageShell current="organize">
      <Suspense fallback={<Fallback />}>
        <EventConsole />
      </Suspense>
    </PageShell>
  );
}
