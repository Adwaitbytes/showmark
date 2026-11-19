"use client";

import { useEffect } from "react";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { ErrorState } from "@/ui/ErrorState";
import { RetryIcon } from "@/ui/icons";
import { SiteHeader } from "@/ui/SiteHeader";
import { Sheet, SheetSection } from "@/ui/Sheet";

function digestOf(error: unknown): string | undefined {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") return error.digest;
  return undefined;
}

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Surfaces the failure in the browser console for whoever is debugging; the server logs carry the digest.
    console.error(error);
  }, [error]);

  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Container className="pt-12 pb-16 sm:pt-20">
          <Sheet className="mx-auto max-w-2xl">
            <SheetSection className="py-10 sm:py-14">
              <ErrorState
                title="This page could not be shown"
                as="h1"
                reference={digestOf(error)}
                action={
                  <>
                    <Button variant="secondary" onClick={() => retry()} leading={<RetryIcon className="size-4" />}>
                      Try again
                    </Button>
                    <Button href="/" variant="quiet">
                      Back to Showmark
                    </Button>
                  </>
                }
              >
                Something went wrong on our side while putting this page together. Check-ins and payouts already on
                chain are not affected. Try again in a moment, and if it keeps happening, send us the reference below.
              </ErrorState>
            </SheetSection>
          </Sheet>
        </Container>
      </main>
    </>
  );
}
