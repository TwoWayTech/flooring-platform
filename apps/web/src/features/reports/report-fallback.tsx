"use client";

import { Building2, RotateCw } from "lucide-react";
import { REPORT_WHOLE_COMPANY } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { QueryFallback } from "@/components/query-fallback";
import type { QueryState } from "@/lib/api/use-api";

interface ReportFallbackProps {
  query: QueryState<unknown>;
  className?: string;
  /** What is loading, for screen readers. */
  label: string;
  /** Reads again which reports this person may open. */
  onRefresh: () => void;
}

/**
 * What a report shows until it is ready. A company-wide report refused because the person's data
 * scope is narrower (ADR 0055 S1) is not a failure to load: it says so in the server's words and
 * offers to read the list of their reports again, which drops the report from the menu. Anything
 * else falls back to the usual skeleton or error with Try again.
 */
export function ReportFallback({ query, className, label, onRefresh }: ReportFallbackProps) {
  if (query.status !== "error" || query.error.message !== REPORT_WHOLE_COMPANY) {
    return <QueryFallback query={query} className={className} label={label} />;
  }
  return (
    <div
      role="status"
      className={cn(
        "border-hairline flex min-h-40 flex-col items-start justify-center gap-3 rounded-md border border-dashed px-5 py-8 sm:items-center sm:text-center",
        className,
      )}
    >
      <Building2 aria-hidden="true" className="text-muted-foreground size-5" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{REPORT_WHOLE_COMPANY}</p>
        <p className="text-muted-foreground text-sm">Your access covers part of the company. Choose another report.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RotateCw />
        Show my reports
      </Button>
    </div>
  );
}
