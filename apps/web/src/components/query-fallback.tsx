"use client";

import { CloudOff, RotateCw } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import type { QueryState } from "@/lib/api/use-api";

interface QueryFallbackProps {
  query: QueryState<unknown>;
  /** Sizes the skeleton and the error box so the layout does not jump when data arrives. */
  className?: string;
  /** What is loading, for screen readers, for example "Loading invoice". */
  label: string;
}

/**
 * What a screen shows until its data is ready: a skeleton while loading, or what went wrong
 * with a Try again button when the read failed (spec Tier 3 "Empty, loading and error states").
 */
export function QueryFallback({ query, className, label }: QueryFallbackProps) {
  if (query.status !== "error") return <Skeleton className={className} aria-label={label} />;
  return (
    <div
      role="alert"
      className={cn(
        "border-hairline flex min-h-40 flex-col items-start justify-center gap-3 rounded-md border border-dashed px-5 py-8 sm:items-center sm:text-center",
        className,
      )}
    >
      <CloudOff aria-hidden="true" className="text-muted-foreground size-5" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">This page could not load its data.</p>
        <p className="text-muted-foreground text-sm">{query.error.message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={query.retry}>
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
