"use client";

import type { ReactNode } from "react";
import { Building2, Lock, RotateCw, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { REPORT_QUERY_MESSAGES, REPORT_WHOLE_COMPANY, TRIAL_BALANCE_HIDDEN } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { QueryFallback } from "@/components/query-fallback";
import type { QueryState } from "@/lib/api/use-api";

/** Every refusal of a report's filters, in the words the API and the demo both use (ADR 0055 S8, S10). */
const FILTER_REFUSALS: ReadonlySet<string> = new Set(Object.values(REPORT_QUERY_MESSAGES));

/** The books' own refusal for a narrower data scope (apps/api `requireCompanyWide`). */
const BOOKS_WHOLE_COMPANY = "The books cover the whole company.";

/**
 * Refusals that mean the person may no longer open this report, with what to do instead. Each offers
 * to read the list of their reports again, which drops the report from the menu.
 */
const ACCESS_REFUSALS: ReadonlyMap<string, { icon: LucideIcon; detail: string }> = new Map([
  [REPORT_WHOLE_COMPANY, { icon: Building2, detail: "Your access covers part of the company. Choose another report." }],
  [BOOKS_WHOLE_COMPANY, { icon: Building2, detail: "Your access covers part of the company. Choose another report." }],
  // The books gained pay or contract postings after the list was read (ADR 0055 "Trial balance").
  [TRIAL_BALANCE_HIDDEN, { icon: Lock, detail: "Ask your company's Owner for that access, or choose another report." }],
]);

interface ReportFallbackProps {
  query: QueryState<unknown>;
  className?: string;
  /** What is loading, for screen readers. */
  label: string;
  /** Reads again which reports this person may open. */
  onRefresh: () => void;
}

interface NoticeProps {
  icon: LucideIcon;
  title: string;
  detail: string;
  className?: string;
  children?: ReactNode;
}

function Notice({ icon: Icon, title, detail, className, children }: NoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        "border-hairline flex min-h-40 flex-col items-start justify-center gap-3 rounded-md border border-dashed px-5 py-8 sm:items-center sm:text-center",
        className,
      )}
    >
      <Icon aria-hidden="true" className="text-muted-foreground size-5" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{detail}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * What a report shows until it is ready. Two refusals are not failures to load, so neither offers
 * a Try again that would only be refused again:
 * - a company-wide report refused because the person's data scope is narrower (ADR 0055 S1), or the
 *   trial balance refused for the cost and pay sight its figures need, says so in the server's
 *   words and offers to read the list of their reports again, which drops the report from the menu;
 * - filters the server refuses (S8, S10: a period too long, a location no longer live) show the
 *   server's words and ask for other filters, which are still on screen above.
 * Anything else falls back to the usual skeleton or error with Try again.
 */
export function ReportFallback({ query, className, label, onRefresh }: ReportFallbackProps) {
  const refusal = query.status === "error" ? ACCESS_REFUSALS.get(query.error.message) : undefined;
  if (query.status === "error" && refusal) {
    return (
      <Notice icon={refusal.icon} title={query.error.message} detail={refusal.detail} className={className}>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RotateCw />
          Show my reports
        </Button>
      </Notice>
    );
  }
  if (query.status === "error" && FILTER_REFUSALS.has(query.error.message)) {
    return (
      <Notice
        icon={SlidersHorizontal}
        title={query.error.message}
        detail="Change the filters above to see the report."
        className={className}
      />
    );
  }
  return <QueryFallback query={query} className={className} label={label} />;
}
