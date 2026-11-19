import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { sampleEvent } from "@/ui/__fixtures__";
import { EventView } from "../../../e/[id]/EventView";

export const metadata: Metadata = { title: "Event preview", robots: { index: false, follow: false } };

/** The event page drawn from fixtures, while the check-in window is open. */
export default function EventPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageShell current="event">
      <Container className="pt-8 pb-8 sm:pt-12">
        <EventView event={sampleEvent} now={Date.parse("2026-11-27T13:00:00.000Z")} />
      </Container>
    </PageShell>
  );
}
