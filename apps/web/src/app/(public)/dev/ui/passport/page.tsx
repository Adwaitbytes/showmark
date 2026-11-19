import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { emptyPassport, samplePassport } from "@/ui/__fixtures__";
import { PassportView } from "../../../p/[id]/PassportView";

export const metadata: Metadata = { title: "Passport preview", robots: { index: false, follow: false } };

/** The passport drawn from fixtures: a full booklet, then an empty one. */
export default function PassportPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageShell>
      <Container className="flex flex-col gap-24 pt-8 pb-8 sm:pt-12">
        <PassportView passport={samplePassport} />
        <PassportView passport={emptyPassport} />
      </Container>
    </PageShell>
  );
}
