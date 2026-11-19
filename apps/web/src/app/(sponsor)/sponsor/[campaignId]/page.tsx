import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { CampaignConsole, CampaignSkeleton } from "../_components/CampaignConsole";

export const metadata: Metadata = {
  title: "Campaign",
  description: "Verified reach for a Showmark campaign, with every payout linked to the QIE explorer.",
};

export default function CampaignPage({ params }: PageProps<"/sponsor/[campaignId]">) {
  return (
    <PageShell current="sponsor">
      <Container className="py-10 sm:py-14">
        <Suspense fallback={<CampaignSkeleton />}>
          {params.then(({ campaignId }) => (
            <CampaignConsole id={campaignId} />
          ))}
        </Suspense>
      </Container>
    </PageShell>
  );
}
