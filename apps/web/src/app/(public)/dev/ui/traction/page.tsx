import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { sampleTraction } from "@/ui/__fixtures__";
import { Definitions, TractionView } from "../../../traction/TractionView";

export const metadata: Metadata = { title: "Traction preview", robots: { index: false, follow: false } };

/** The traction ledger drawn from fixtures, to review the populated state before real data exists. */
export default function TractionPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageShell current="traction">
      <Container className="flex flex-col gap-16 pt-12 pb-8 sm:pt-16">
        <h1 className="font-display text-4xl sm:text-5xl">Traction preview (fixtures)</h1>
        <TractionView traction={sampleTraction} />
        <Definitions />
      </Container>
    </PageShell>
  );
}
