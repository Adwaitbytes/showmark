import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton, SkeletonText } from "@/ui/Skeleton";

export function TractionSkeleton() {
  return (
    <LoadingRegion label="Reading the traction ledger from the chain" className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-10">
        <Skeleton className="h-24 w-48" />
        <SkeletonText lines={2} className="w-full max-w-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        {[0, 1].map((i) => (
          <Sheet key={i}>
            <SheetSection className="flex flex-col gap-4">
              <Skeleton className="h-6 w-32" />
              <SkeletonText lines={5} />
            </SheetSection>
          </Sheet>
        ))}
      </div>
      <Sheet>
        <SheetSection>
          <Skeleton className="h-64 w-full" />
        </SheetSection>
      </Sheet>
    </LoadingRegion>
  );
}
