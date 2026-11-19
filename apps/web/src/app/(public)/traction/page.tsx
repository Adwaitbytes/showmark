import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { activeChain } from "@/lib/chain/chains";
import { getTraction } from "@/server/queries";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { ErrorState } from "@/ui/ErrorState";
import { formatDate, formatTime } from "@/ui/format";
import { PageShell } from "@/ui/PageShell";
import { SectionBoundary } from "@/ui/SectionBoundary";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { load } from "../_components/load";
import { TractionSkeleton } from "./TractionSkeleton";
import { Definitions, TractionView } from "./TractionView";

export const metadata: Metadata = {
  title: "Traction",
  description: "Verified attendees, events, sponsors and money settled, read straight from QIE. Team-funded pools are labeled apart from outside sponsors.",
};

async function LiveTraction() {
  await connection();
  const result = await load(getTraction);
  if (!result.ok) {
    return (
      <Sheet>
        <SheetSection>
          <ErrorState title={result.message} action={<Button href="/traction" variant="quiet">Try again</Button>}>
            {result.action}
          </ErrorState>
        </SheetSection>
      </Sheet>
    );
  }
  return (
    <>
      <p className="-mt-6 mb-10 text-sm text-ink-faint sm:-mt-8">
        Read from {activeChain.name} on {formatDate(result.data.updatedAt)} at {formatTime(result.data.updatedAt)}.
      </p>
      <TractionView traction={result.data} />
    </>
  );
}

export default function TractionPage() {
  return (
    <PageShell current="traction">
      <Container className="flex flex-col gap-16 pt-12 pb-8 sm:pt-16">
        <header className="flex max-w-3xl flex-col gap-4">
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Traction</h1>
          <p className="text-md text-ink-soft sm:text-lg sm:leading-[1.45]">
            Every number here is read from QIE through our indexer and links back to the chain. Pools the team funded
            are counted apart from outside sponsors, so you can see exactly how much of this is us.
          </p>
        </header>
        <div>
          <SectionBoundary title="The traction ledger did not load">
            <Suspense fallback={<TractionSkeleton />}>
              <LiveTraction />
            </Suspense>
          </SectionBoundary>
        </div>
        <Definitions />
      </Container>
    </PageShell>
  );
}
