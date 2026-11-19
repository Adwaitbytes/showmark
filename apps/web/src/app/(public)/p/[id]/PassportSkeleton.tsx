import { Sheet } from "@/ui/Sheet";
import { LoadingRegion, Skeleton, SkeletonStamp, SkeletonText } from "@/ui/Skeleton";

export function PassportSkeleton() {
  return (
    <LoadingRegion label="Opening the passport" className="flex flex-col gap-12">
      <Sheet className="overflow-hidden">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="grid gap-8 px-5 py-7 sm:grid-cols-[auto_1fr] sm:gap-10 sm:px-9 sm:py-9">
          <SkeletonStamp className="mx-auto w-44 sm:w-52" />
          <div className="flex flex-col gap-5">
            <Skeleton className="h-12 w-2/3" />
            <SkeletonText lines={4} className="max-w-md" />
          </div>
        </div>
      </Sheet>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="aspect-[5/6] w-full" />
        <Skeleton className="aspect-[5/6] w-full max-md:hidden" />
      </div>
    </LoadingRegion>
  );
}
