import type { Metadata } from "next";
import { PageShell } from "@/ui/PageShell";
import { NewEventForm } from "../../_components/NewEventForm";

export const metadata: Metadata = {
  title: "Create an event",
  robots: { index: false, follow: false },
};

export default function NewEventPage() {
  return (
    <PageShell current="organize">
      <NewEventForm />
    </PageShell>
  );
}
