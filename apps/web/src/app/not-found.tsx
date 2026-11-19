import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { PageShell } from "@/ui/PageShell";
import { Sheet, SheetSection } from "@/ui/Sheet";

export default function NotFound() {
  return (
    <PageShell>
      <Container className="pt-12 pb-8 sm:pt-20">
        <Sheet className="mx-auto max-w-2xl">
          <SheetSection className="py-10 sm:py-14">
            <EmptyState
              title="There is no page at this address"
              as="h1"
              action={
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button href="/" variant="secondary">
                    Back to Showmark
                  </Button>
                  <Button href="/docs" variant="quiet">
                    Read the docs
                  </Button>
                </div>
              }
            >
              The link may have a typo, or the page may have moved. If you were scanning a door code, scan the code on
              the door screen again.
            </EmptyState>
          </SheetSection>
        </Sheet>
      </Container>
    </PageShell>
  );
}
