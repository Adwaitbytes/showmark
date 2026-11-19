import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isDeployed } from "@/lib/chain/addresses";
import { activeChain } from "@/lib/chain/chains";
import { getPassport } from "@/server/queries";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { shortAddress } from "@/ui/format";
import { PageShell } from "@/ui/PageShell";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { load } from "../../_components/load";
import { PassportSkeleton } from "./PassportSkeleton";
import { PassportView } from "./PassportView";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QIE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.qie$/i;

/** Accepts an address or a .qie name (with or without the suffix). Null for anything else. */
function parseHolder(raw: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  if (ADDRESS.test(value)) return value;
  const name = value.toLowerCase().endsWith(".qie") ? value.toLowerCase() : `${value.toLowerCase()}.qie`;
  return QIE_NAME.test(name) ? name : null;
}

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  const holder = parseHolder(id);
  if (!holder) return { title: "Passport not found" };
  const shown = ADDRESS.test(holder) ? shortAddress(holder) : holder;
  return {
    title: `${shown}'s passport`,
    description: `Every Showmark stamp ${shown} has collected, each one a check-in recorded on QIE.`,
  };
}

async function PassportContent({ params }: Pick<PageProps<"/p/[id]">, "params">) {
  const { id } = await params;
  const holder = parseHolder(id);
  if (!holder) notFound();
  if (!isDeployed()) {
    return (
      <Sheet>
        <SheetSection className="py-10">
          <EmptyState
            title="Passports open once the contracts are live"
            as="h1"
            action={
              <Button href="/" variant="secondary">
                Back to Showmark
              </Button>
            }
          >
            The Showmark contracts are not deployed on {activeChain.name} yet, so there are no stamps to show for{" "}
            {ADDRESS.test(holder) ? shortAddress(holder) : holder}. Every passport fills in straight from the chain.
          </EmptyState>
        </SheetSection>
      </Sheet>
    );
  }
  await connection();
  const result = await load(() => getPassport(holder));
  if (!result.ok) {
    return (
      <Sheet>
        <SheetSection className="py-10">
          <ErrorState
            title={result.message}
            as="h1"
            action={
              <Button href={`/p/${encodeURIComponent(holder)}`} variant="quiet">
                Try again
              </Button>
            }
          >
            {result.action}
          </ErrorState>
        </SheetSection>
      </Sheet>
    );
  }
  if (!result.data) notFound();
  return <PassportView passport={result.data} />;
}

export default function PassportPage({ params }: PageProps<"/p/[id]">) {
  return (
    <PageShell current="none">
      <Container className="pt-8 pb-8 sm:pt-12">
        <Suspense fallback={<PassportSkeleton />}>
          <PassportContent params={params} />
        </Suspense>
      </Container>
    </PageShell>
  );
}
