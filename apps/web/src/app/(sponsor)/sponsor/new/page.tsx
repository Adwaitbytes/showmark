import type { Metadata } from "next";
import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { CreateCampaign } from "../_components/CreateCampaign";

export const metadata: Metadata = {
  title: "New campaign",
  description: "Lock a budget in escrow on QIE and pay a fixed amount for each verified person at the door.",
};

export default function NewCampaignPage() {
  return (
    <PageShell current="sponsor">
      <Container className="py-10 sm:py-14">
        <CreateCampaign />
      </Container>
    </PageShell>
  );
}
