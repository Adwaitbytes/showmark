import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { PageShell } from "@/ui/PageShell";
import { Sheet, SheetSection } from "@/ui/Sheet";

export default function EventNotFound() {
  return (
    <PageShell current="event">
      <Container className="pt-8 pb-8 sm:pt-12">
        <Sheet>
          <SheetSection className="py-10">
            <EmptyState
              title="No event with that number"
              as="h1"
              action={
                <Button href="/" variant="secondary">
                  Back to Showmark
                </Button>
              }
            >
              Event numbers come from the chain and start at 1. Check the link on the door poster, or ask the organizer
              for the event page.
            </EmptyState>
          </SheetSection>
        </Sheet>
      </Container>
    </PageShell>
  );
}
