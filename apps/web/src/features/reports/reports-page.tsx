"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { REPORT_CATALOG, type ReportKey, type ReportOptions } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { cn } from "@workspace/ui/lib/utils";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { BusinessReportView } from "./business-report";
import { HubReportView, isHubReport } from "./hub-report";

function ReportsNav({ reports, current }: { reports: readonly ReportKey[]; current: ReportKey }) {
  const router = useRouter();
  return (
    <nav aria-label="Reports" className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {reports.map((k) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => router.replace(`/reports?report=${k}`)}
              aria-current={k === current ? "page" : undefined}
              className={cn(
                "flex h-9 w-full items-center rounded-md px-2.5 text-left text-sm whitespace-nowrap",
                k === current ? "bg-brand-soft text-brand-ink font-medium" : "hover:bg-raised",
              )}
            >
              {REPORT_CATALOG[k].label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ReportsHub({ options, onRefresh }: { options: ReportOptions; onRefresh: () => void }) {
  const params = useSearchParams();
  const hub = options.reports.filter(isHubReport);
  const hasBusiness = options.reports.includes("business");
  const requested = params.get("report");
  const key = hub.find((k) => k === requested) ?? hub[0] ?? null;
  // Rule 1: the Business report shows when the person may open it and the address asks for it, asks
  // for nothing, or asks for a report they may not open; otherwise the asked-for or first report shows.
  const showBusiness = hasBusiness && (key === null || requested !== key);
  return (
    <>
      <PageHeader title="Reports" />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <ReportsNav reports={options.reports} current={showBusiness || key === null ? "business" : key} />
        {showBusiness ? (
          <BusinessReportView options={options} onRefresh={onRefresh} />
        ) : key ? (
          <HubReportView reportKey={key} options={options} onRefresh={onRefresh} />
        ) : null}
      </div>
    </>
  );
}

/**
 * The reports hub (spec "Purpose" and rule 1): the Business report first, then Profit and loss,
 * Sales by category and Payments received. Which reports show and export, and the pickers' choices,
 * come from the server (`reportOptions`, ADR 0055), so a report the person may not open, such as a
 * company-wide one for a branch manager (S1) or one that is switched off, is never offered.
 */
export function ReportsPage() {
  const options = useApiQuery((client) => client.reportOptions(), []);
  if (options.status !== "ready") {
    return (
      <>
        <PageHeader title="Reports" />
        <QueryFallback query={options} className="h-96" label="Loading reports" />
      </>
    );
  }
  if (options.data.reports.length === 0) return <NoAccess />;
  return <ReportsHub options={options.data} onRefresh={options.retry} />;
}
