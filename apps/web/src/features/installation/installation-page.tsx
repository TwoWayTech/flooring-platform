"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, mondayOf, type Crew, type Job } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import { ScrollRegion } from "@/components/scroll-region";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { JobCard } from "./job-card";
import { hourLabel } from "./job-status";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_EDGE: Record<Job["status"], string> = {
  scheduled: "border-l-hairline",
  in_progress: "border-l-brand",
  completed: "border-l-warning",
  signed_off: "border-l-success",
};

/**
 * Installation (spec Tier 2): a week calendar with a row per crew and subcontractor; a job opens
 * its card. `?week=` picks the week and `?job=` opens a job (the dashboard timeline links here).
 */
export function InstallationPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const formatDate = useFormatDate();
  const today = api.today();
  const week = mondayOf(params.get("week") ?? today);
  const data = useApiQuery(async (client) => {
    const [jobs, crews, customers] = await Promise.all([
      client.list("jobs"),
      client.list("crews"),
      client.list("customers"),
    ]);
    return { jobs, crews, customers };
  }, []);
  if (!can("installation.job.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading installation" />;

  const { jobs, crews, customers } = data.data;
  const days = DAY_NAMES.map((_, i) => addDays(week, i));
  const openJob = jobs.find((j) => j.id === params.get("job")) ?? null;
  const go = (query: Record<string, string>) =>
    router.replace(`/installation?${new URLSearchParams({ week, ...query })}`);
  const visibleCrews = crews.filter((c) => jobs.some((j) => j.crewId === c.id) || can("installation.crew.view"));
  const customerName = (job: Job) =>
    customers
      .find((c) => c.id === job.customerId)
      ?.contactName.split(" ")
      .at(-1) ?? "";

  return (
    <>
      <PageHeader title="Installation" />
      <Panel
        title={`Week of ${formatDate(week)}`}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => go({ week: addDays(week, -7) })}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => go({ week: mondayOf(today) })}>
              This week
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next week"
              onClick={() => go({ week: addDays(week, 7) })}
            >
              <ChevronRight />
            </Button>
          </div>
        }
        bodyClassName="p-0"
      >
        <ScrollRegion label="Crew calendar">
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <thead className="bg-raised text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="h-10 w-40 px-3 text-left font-medium">
                  Crew
                </th>
                {days.map((d, i) => (
                  <th key={d} scope="col" className={cn("px-2 text-left font-medium", d === today && "text-brand-ink")}>
                    {DAY_NAMES[i]} {formatDate(d).replace(/,? \d{4}$/, "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCrews.map((crew: Crew) => (
                <tr key={crew.id} className="border-hairline border-t align-top">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="block font-medium">{crew.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {crew.kind === "subcontractor" ? "Subcontractor, 1099" : `Crew, led by ${crew.lead}`}
                    </span>
                  </th>
                  {days.map((d) => (
                    <td key={d} className={cn("px-1.5 py-1.5", d === today && "bg-brand-soft/40")}>
                      <div className="flex flex-col gap-1">
                        {jobs
                          .filter((j) => j.crewId === crew.id && j.date === d)
                          .map((job) => (
                            <button
                              key={job.id}
                              type="button"
                              onClick={() => go({ job: job.id })}
                              className={cn(
                                "bg-surface border-hairline hover:bg-raised rounded-sm border border-l-4 px-2 py-1 text-left text-xs",
                                STATUS_EDGE[job.status],
                              )}
                            >
                              <span className="block font-medium">
                                <span className="sr-only">Open job </span>
                                {job.number}
                              </span>
                              <span className="text-muted-foreground block truncate">
                                {hourLabel(job.startHour)}, {customerName(job)}
                              </span>
                            </button>
                          ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        {jobs.some((j) => j.date >= days[0]! && j.date <= days[6]!) ? null : (
          <p className="text-muted-foreground border-hairline border-t px-4 py-3 text-sm">
            No installations are booked this week. Use Next week to look ahead.
          </p>
        )}
      </Panel>
      <JobCard
        job={openJob}
        crew={crews.find((c) => c.id === openJob?.crewId)}
        customer={customers.find((c) => c.id === openJob?.customerId)}
        onClose={() => go({})}
      />
    </>
  );
}
