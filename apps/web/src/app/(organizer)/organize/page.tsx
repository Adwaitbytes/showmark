import type { Metadata } from "next";
import { PageShell } from "@/ui/PageShell";
import { OrganizerHome } from "../_components/OrganizerHome";

export const metadata: Metadata = {
  title: "Organize",
  description: "Create events on QIE, run a signed door screen and see every check-in and payout.",
};

export default function OrganizePage() {
  return (
    <PageShell current="organize">
      <OrganizerHome />
    </PageShell>
  );
}
