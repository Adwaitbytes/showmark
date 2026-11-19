import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton, SkeletonStamp, SkeletonText } from "@/ui/Skeleton";

export function EventSkeleton() {
  return (
    <LoadingRegion label="Loading the event from the chain" className="flex flex-col gap-10">
      <Sheet>
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="flex flex-col lg:flex-row">
          <SheetSection className="flex flex-1 flex-col gap-6 py-8 sm:py-10">
            <Skeleton className="h-7 w-32 rounded-pill" />
            <Skeleton className="h-14 w-4/5" />
            <SkeletonText lines={3} className="max-w-lg" />
          </SheetSection>
          <SheetSection className="flex flex-col items-center gap-6 py-8 sm:py-10 lg:w-[22rem]">
            <Skeleton className="h-12 w-28 self-start" />
            <SkeletonStamp className="w-40" />
          </SheetSection>
        </div>
      </Sheet>
      <SkeletonText lines={4} className="max-w-2xl" />
    </LoadingRegion>
  );
}
