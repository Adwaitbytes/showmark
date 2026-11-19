import { LoadingRegion, Skeleton } from "@/ui/Skeleton";

/** Static shell for the door routes while the event number is read from the URL. */
export function DoorFallback({ label }: { label: string }) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh flex-col focus:outline-none">
      <div className="h-14" />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <LoadingRegion label={label} className="flex w-full max-w-3xl flex-col items-center gap-8 sm:flex-row">
          <Skeleton className="aspect-square w-full max-w-sm" />
          <div className="flex w-full flex-col gap-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-32 w-48" />
            <Skeleton className="h-5 w-56" />
          </div>
        </LoadingRegion>
      </div>
    </main>
  );
}
