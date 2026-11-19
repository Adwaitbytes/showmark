import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { PassportSkeleton } from "./PassportSkeleton";

export default function Loading() {
  return (
    <PageShell>
      <Container className="pt-8 pb-8 sm:pt-12">
        <PassportSkeleton />
      </Container>
    </PageShell>
  );
}
