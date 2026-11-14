"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Cake, ChevronRight, PartyPopper } from "lucide-react";
import { addDays, featureOn, upcomingPersonDates, type Employee } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
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

/** One line of the to-do list: a count, what it is, and where to act on it. */
function Action({ count, label, href }: { count: number; label: string; href: string }) {
  if (count === 0) return null;
  return (
    <li>
      <Link href={href} className="hover:bg-raised flex items-center gap-3 px-4 py-3">
        <span className="bg-brand/12 text-foreground font-display grid size-8 place-items-center rounded-md text-sm font-semibold tabular-nums">
          {count}
        </span>
        <span className="min-w-0 flex-1 text-sm">{label}</span>
        <ChevronRight aria-hidden="true" className="text-muted-foreground size-4" />
      </Link>
    </li>
  );
}

const PERIOD_STATUS = { open: "Open", in_review: "In review", approved: "Approved", exported: "Exported" } as const;

/**
 * HR Home (spec C1): what needs a decision first (timesheets, time off, commission statements and
 * the pay run), then the people facts HR works with: birthdays, anniversaries and holidays.
 */
export function HrDashboard() {
  const can = useCan();
  const { settings, product } = useWorkspace();
  const formatDate = useFormatDate();
  const seesCommission = can("hr.commission.view") && featureOn("hr.commissions") && product.key === "flooring";
  const seesPay = can("hr.payroll.view") && featureOn("hr.pay-periods");
  const data = useApiQuery(
    async (client) => {
      const [{ employees, timesheets, ptoRequests }, statements, periods] = await Promise.all([
        client.hrData(),
        seesCommission ? client.listCommissionStatements() : Promise.resolve([]),
        seesPay ? client.listPayPeriods() : Promise.resolve([]),
      ]);
      return { employees, timesheets, ptoRequests, statements, periods };
    },
    [seesCommission, seesPay],
  );
  const today = api.today();
  const peopleDates = useMemo(
    () => (data.data ? upcomingPersonDates(data.data.employees, today, 21).slice(0, 8) : []),
    [data.data, today],
  );
  if (!can("hr.overview.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading HR" />;

  const { employees, timesheets, ptoRequests, statements, periods } = data.data;
  const active = employees.filter((e) => e.status !== "terminated");
  const week = weeksOf(timesheets)[0] ?? "";
  const rows = weekRows(timesheets, employees, week, settings.localization.payroll.overtimeRule);
  const upcoming = ptoRequests
    .filter(
      (p) => (p.status === "pending" || p.status === "approved") && p.end >= today && p.start <= addDays(today, 30),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const departments = byDepartment(active);
  const largest = departments[0]?.[1] ?? 1;
  const holidays = settings.hr.holidays.filter((h) => h.date >= today).slice(0, 4);
  const toApprove = timesheets.filter((s) => s.status === "submitted").length;
  const toDecide = ptoRequests.filter((p) => p.status === "pending").length;
  const statementsDue = statements.filter((s) => s.status === "draft" && s.monthEnded && s.lines.length > 0).length;
  const run = periods.find((p) => p.status === "in_review" || p.status === "approved") ?? periods[0];
  const nothingDue = toApprove + toDecide + statementsDue === 0 && !run;

  return (
    <>
      <PageHeader title={product.key === "hr" ? "HR dashboard" : "HR"} />
      <HrTabs />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Needs action" bodyClassName="p-0">
            {nothingDue ? (
              <p className="text-muted-foreground p-4 text-sm">Nothing is waiting for you.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                <Action count={toApprove} label="Timesheets to approve" href="/hr/timesheets?view=queue" />
                <Action count={toDecide} label="Time-off requests to decide" href="/hr/time-off" />
                <Action count={statementsDue} label="Commission statements to approve" href="/hr/commissions" />
                {run ? (
                  <li>
                    <Link href="/hr/pay-periods" className="hover:bg-raised flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 text-sm">
                        Pay period {formatDate(run.start)} to {formatDate(run.end)}:{" "}
                        <span className="font-medium">{PERIOD_STATUS[run.status]}</span>
                      </span>
                      <ChevronRight aria-hidden="true" className="text-muted-foreground size-4" />
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </Panel>
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
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Birthdays and anniversaries" bodyClassName="p-0">
            {peopleDates.length === 0 ? (
              <p className="text-muted-foreground p-4 text-sm">None in the next three weeks.</p>
            ) : (
              <ul className="divide-hairline divide-y text-sm">
                {peopleDates.map((d) => (
                  <li key={`${d.employeeId}-${d.kind}`} className="flex items-center gap-2 px-4 py-2.5">
                    {d.kind === "birthday" ? (
                      <Cake aria-hidden="true" className="text-chart-3 size-4 shrink-0" />
                    ) : (
                      <PartyPopper aria-hidden="true" className="text-brand-ink size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {d.name}
                      {d.years ? `, ${d.years} years` : ""}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">{formatDate(d.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Upcoming holidays" bodyClassName="p-0">
            <ul className="divide-hairline divide-y text-sm">
              {holidays.map((h) => (
                <li key={h.date} className="flex justify-between gap-3 px-4 py-2.5">
                  <span>{h.name}</span>
                  <span className="text-muted-foreground whitespace-nowrap">{formatDate(h.date)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {featureOn("hr.time-off") ? (
            <Panel title="Time off, next 30 days" bodyClassName="p-0">
              {upcoming.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">Nobody is off in the next 30 days.</p>
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
