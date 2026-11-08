"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { featureOn, addDays, type Employee } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { AttentionPanel } from "@/features/dashboard/attention-panel";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { HrTabs } from "./hr-tabs";
import { weekRows, weeksOf } from "./hr-week";

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-xl font-semibold tracking-[-0.01em] sm:text-2xl">{children}</dd>
    </div>
  );
}

/** Active headcount per department, largest first. */
function byDepartment(employees: readonly Employee[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of employees) counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** The HR dashboard (spec "HR host"): headcount, this week's hours and overtime, time off, and what needs attention. */
export function HrDashboard() {
  const can = useCan();
  const { settings, product } = useWorkspace();
  const formatDate = useFormatDate();
  const data = useApiQuery(async (client) => {
    const [employees, timesheets, ptoRequests] = await Promise.all([
      client.list("employees"),
      client.list("timesheets"),
      client.list("ptoRequests"),
    ]);
    return { employees, timesheets, ptoRequests };
  }, []);
  if (!can("hr.overview.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading HR" />;

  const { employees, timesheets, ptoRequests } = data.data;
  const active = employees.filter((e) => e.status !== "terminated");
  const week = weeksOf(timesheets)[0] ?? "";
  const rows = weekRows(timesheets, employees, week, settings.localization.payroll.overtimeRule);
  const today = api.today();
  const upcoming = ptoRequests
    .filter((p) => p.status !== "denied" && p.end >= today && p.start <= addDays(today, 30))
    .sort((a, b) => a.start.localeCompare(b.start));
  const departments = byDepartment(active);
  const largest = departments[0]?.[1] ?? 1;

  return (
    <>
      <PageHeader title={product.key === "hr" ? "HR dashboard" : "HR"} />
      <HrTabs />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="People and hours this week">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Headcount">
                <Num kind="count" value={active.length} />
              </Figure>
              <Figure label="Contractors (1099)">
                <Num kind="count" value={active.filter((e) => e.workerType === "1099").length} />
              </Figure>
              <Figure label="Hours this week">
                <Num kind="quantity" value={rows.reduce((s, r) => s + r.total, 0)} />
              </Figure>
              <Figure label="Overtime hours">
                <Num kind="quantity" value={rows.reduce((s, r) => s + r.split.overtime + r.split.doubleTime, 0)} />
              </Figure>
            </dl>
          </Panel>
          <Panel title="Headcount by department">
            <ul className="flex flex-col gap-2.5">
              {departments.map(([name, count]) => (
                <li key={name} className="grid grid-cols-[9rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
                  <span className="truncate">{name}</span>
                  <span className="bg-raised h-2 overflow-hidden rounded-full" aria-hidden="true">
                    <span
                      className="bg-chart-1 block h-full rounded-full"
                      style={{ width: `${(count / largest) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="order-first flex min-w-0 flex-col gap-6 lg:order-none">
          <AttentionPanel />
          {featureOn("hr.time-off") ? (
            <Panel title="Time off, next 30 days" bodyClassName="p-0">
              {upcoming.length === 0 ? (
                <p className="text-muted-foreground p-4">Nobody is off in the next 30 days.</p>
              ) : (
                <ul className="divide-hairline divide-y text-sm">
                  {upcoming.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <Link href="/hr/time-off" className="hover:bg-raised flex justify-between gap-3 px-4 py-2.5">
                        <span>{employees.find((e) => e.id === p.employeeId)?.name}</span>
                        <span className="text-muted-foreground">
                          {formatDate(p.start)}
                          {p.status === "pending" ? ", pending" : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
