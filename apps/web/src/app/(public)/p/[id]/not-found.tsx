import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { PageShell } from "@/ui/PageShell";
import { Sheet, SheetSection } from "@/ui/Sheet";

export default function PassportNotFound() {
  return (
    <PageShell>
      <Container className="pt-8 pb-8 sm:pt-12">
        <Sheet>
          <SheetSection className="py-10">
            <EmptyState
              title="No passport at that address"
              as="h1"
              action={
                <Button href="/me" variant="secondary">
                  Open my passport
                </Button>
              }
            >
              Passports are found by a wallet or pass address, like 0x7aE3…1A3b, or by a QIE ID name, like asha.qie.
              Check the link, or open your own passport on this phone.
            </EmptyState>
          </SheetSection>
        </Sheet>
      </Container>
    </PageShell>
  );
}
