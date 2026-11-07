import { Skeleton } from "@workspace/ui/components/skeleton";

/** Shown while the company's data opens: the shell's outline, so the page does not jump. */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading">
      <div className="hidden flex-col gap-3 px-3 py-4 lg:flex">
        <Skeleton className="h-14 w-full" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-6 px-4 py-4 lg:px-8">
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
