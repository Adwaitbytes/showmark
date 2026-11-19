import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isDeployed } from "@/lib/chain/addresses";
import { activeChain } from "@/lib/chain/chains";
import { isAppError } from "@/server/errors";
import { getEvent } from "@/server/queries";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { PageShell } from "@/ui/PageShell";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { load, requestTime } from "../../_components/load";
import { EventSkeleton } from "./EventSkeleton";
import { EventView } from "./EventView";

const EVENT_ID = /^[1-9]\d{0,19}$/;

export async function generateMetadata({ params }: PageProps<"/e/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!EVENT_ID.test(id) || !isDeployed()) return { title: `Event ${id}` };
  try {
    const event = await getEvent(id);
    if (!event) return { title: "Event not found" };
    return {
      title: event.metadata.name,
      description: `${event.metadata.venue}, ${event.metadata.city}. Check in at the door with your phone and get a Showmark stamp.`,
    };
  } catch (error) {
    // Metadata must not take the page down; the page body reports the same failure properly.
    if (isAppError(error)) return { title: `Event ${id}` };
    throw error;
  }
}

async function EventContent({ params }: Pick<PageProps<"/e/[id]">, "params">) {
  const { id } = await params;
  if (!EVENT_ID.test(id)) notFound();
  if (!isDeployed()) {
    return (
      <Sheet>
        <SheetSection className="py-10">
          <EmptyState title="Events open once the contracts are live" as="h1" action={<Button href="/" variant="secondary">Back to Showmark</Button>}>
            The Showmark contracts are not deployed on {activeChain.name} yet, so there is no event {id} to show. Event
            pages fill in straight from the chain once they are.
          </EmptyState>
        </SheetSection>
      </Sheet>
    );
  }
  const now = await requestTime();
  const result = await load(() => getEvent(id));
  if (!result.ok) {
    return (
      <Sheet>
        <SheetSection className="py-10">
          <ErrorState title={result.message} as="h1" action={<Button href={`/e/${id}`} variant="quiet">Try again</Button>}>
            {result.action}
          </ErrorState>
        </SheetSection>
      </Sheet>
    );
  }
  if (!result.data) notFound();
  return <EventView event={result.data} now={now} />;
}

export default function EventPage({ params }: PageProps<"/e/[id]">) {
  return (
    <PageShell current="event">
      <Container className="pt-8 pb-8 sm:pt-12">
        <Suspense fallback={<EventSkeleton />}>
          <EventContent params={params} />
        </Suspense>
      </Container>
    </PageShell>
  );
}
