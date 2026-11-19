import { Container } from "@/ui/Container";
import { PageShell } from "@/ui/PageShell";
import { Skeleton } from "@/ui/Skeleton";
import { TractionSkeleton } from "./TractionSkeleton";

export default function Loading() {
  return (
    <PageShell current="traction">
      <Container className="flex flex-col gap-16 pt-12 pb-8 sm:pt-16">
        <div className="flex max-w-3xl flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-16 w-56" />
          <Skeleton className="h-5 w-full" />
        </div>
        <TractionSkeleton />
      </Container>
    </PageShell>
  );
}
