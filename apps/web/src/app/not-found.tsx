import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { Perforation } from "@/ui/Perforation";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { RubberMark } from "@/ui/stamp/RubberMark";

export default function NotFound() {
  return (
    <PageShell>
      <Container className="pt-12 pb-8 sm:pt-20">
        <div className="mx-auto max-w-xl">
          <Sheet edge="stub-bottom">
            <SheetSection className="flex flex-col gap-4 py-8 sm:py-10">
              <p className="text-sm text-ink-soft">Admit one</p>
              <h1 className="font-display text-3xl text-ink sm:text-4xl">There is no page at this address</h1>
              <p className="text-base text-ink-soft">
                The link may have a typo, or the page may have moved. If you were scanning a door code, scan the code
                on the door screen again.
              </p>
            </SheetSection>
            <Perforation />
            <SheetSection className="relative grid place-items-center pt-8 pb-12">
              <RubberMark lines={["Not admitted"]} seed="not-found" className="w-56 sm:w-64" />
            </SheetSection>
          </Sheet>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="/" variant="secondary">
              Back to Showmark
            </Button>
            <Button href="/docs" variant="quiet">
              Read the docs
            </Button>
          </div>
        </div>
      </Container>
    </PageShell>
  );
}
