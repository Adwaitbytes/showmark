import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { EventSkeleton } from "./EventSkeleton";

export default function Loading() {
  return (
    <PageShell current="event">
      <Container className="pt-8 pb-8 sm:pt-12">
        <EventSkeleton />
      </Container>
    </PageShell>
  );
}
