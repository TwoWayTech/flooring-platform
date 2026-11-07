"use client";

import Link from "next/link";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import type { TimelineJob } from "./use-dashboard-data";

/** The working day the timeline shows, in hours. */
const DAY_START = 7;
const DAY_END = 18;
const SPAN = DAY_END - DAY_START;
const TICKS = [8, 11, 14, 17];

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "am" : "pm"}`;
}

/** Groups today's jobs by crew, in the order the first job starts. */
function byCrew(jobs: readonly TimelineJob[]) {
  const groups = new Map<string, TimelineJob[]>();
  for (const job of jobs) groups.set(job.crew.id, [...(groups.get(job.crew.id) ?? []), job]);
  return [...groups.values()];
}

/** Today's jobs as a timeline by crew (design brief "Dashboard"), each block opening its job card. */
export function TodaysJobs({ jobs }: { jobs: readonly TimelineJob[] }) {
  return (
    <Panel title="Today's jobs">
      {jobs.length === 0 ? (
        <p className="text-muted-foreground">No installations today.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3" aria-hidden="true">
            <span className="w-28 shrink-0" />
            <div className="text-muted-foreground relative h-4 flex-1 text-2xs tabular-nums">
              {TICKS.map((h) => (
                <span
                  key={h}
                  className={cn(
                    "absolute whitespace-nowrap",
                    h === TICKS.at(-1) ? "-translate-x-full" : "-translate-x-1/2",
                  )}
                  style={{ left: `${((h - DAY_START) / SPAN) * 100}%` }}
                >
                  {hourLabel(h)}
                </span>
              ))}
            </div>
          </div>
          {byCrew(jobs).map((group) => (
            <div key={group[0]!.crew.id} className="flex items-center gap-3">
              <span className="line-clamp-2 w-28 shrink-0 text-xs leading-tight font-medium">
                {group[0]!.crew.name}
              </span>
              <div className="bg-raised relative h-9 flex-1 rounded-sm">
                {group.map(({ job, customer }) => (
                  <Link
                    key={job.id}
                    href={`/installation?job=${job.id}`}
                    title={`${job.number}, ${customer?.name ?? "Customer"}, ${hourLabel(job.startHour)} for ${job.durationHours} h`}
                    className="bg-brand-soft text-brand-ink border-brand/40 hover:bg-brand/20 absolute inset-y-1 flex items-center overflow-hidden rounded-sm border px-1.5 text-2xs font-medium whitespace-nowrap"
                    style={{
                      left: `${((job.startHour - DAY_START) / SPAN) * 100}%`,
                      width: `${(Math.min(job.durationHours, DAY_END - job.startHour) / SPAN) * 100}%`,
                    }}
                  >
                    {job.number} {customer?.contactName.split(" ").at(-1)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
