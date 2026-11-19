import type { Metadata } from "next";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { SponsorHome } from "./_components/SponsorHome";

export const metadata: Metadata = {
  title: "Sponsor console",
  description: "Fund events per verified attendee. Every payout is a transaction on QIE you can open on the explorer.",
};

export default function SponsorPage() {
  return (
    <PageShell current="sponsor">
      <Container className="py-10 sm:py-14">
        <SponsorHome />
      </Container>
    </PageShell>
  );
}
