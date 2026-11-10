"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, workweekStartOf, type Employee, type PtoRequest } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import { ScrollRegion } from "@/components/scroll-region";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";

const KIND_LABEL: Record<PtoRequest["kind"], string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  unpaid: "Unpaid",
};

/**
 * Who is out, a month at a time (spec C1, ADR 0024). `kinds` is off in the portal, where a colleague
 * sees only that someone is out, never why.
 */
export function TeamCalendar({
  requests,
  employees,
  kinds,
}: {
  requests: readonly PtoRequest[];
  employees: readonly Pick<Employee, "id" | "name">[];
  kinds: boolean;
}) {
  const { settings } = useWorkspace();
  const formatDate = useFormatDate();
  const [offset, setOffset] = useState(0);
  const today = api.today();
  const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + offset, 1))
    .toISOString()
    .slice(0, 10);
  const nextMonth = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 10);
  const start = workweekStartOf(first, settings.hr.workweekStartDay);
  const weeks = Math.ceil((Date.parse(nextMonth) - Date.parse(start)) / (7 * 86_400_000));
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const away = requests.filter((r) => r.status === "approved");
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? "Someone";
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(`${addDays(start, i)}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
  );
  const month = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <Panel
      title={month}
      actions={
        <span className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => setOffset(offset + 1)}>
            <ChevronRight />
          </Button>
        </span>
      }
      bodyClassName="p-0"
    >
      <ScrollRegion label="Team calendar">
        <div className="grid min-w-[44rem] grid-cols-7 text-sm">
          {weekdays.map((d) => (
            <div key={d} className="bg-raised text-muted-foreground px-2 py-1.5 text-xs font-medium">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const out = away.filter((r) => r.start <= day && r.end >= day);
            const inMonth = day >= first && day < nextMonth;
            return (
              <div
                key={day}
                className={cn(
                  "border-hairline min-h-20 border-t border-l p-1.5",
                  !inMonth && "bg-raised/50 text-muted-foreground",
                )}
              >
                <div
                  className={cn("text-xs tabular-nums", day === today && "text-brand-ink font-semibold")}
                  aria-label={formatDate(day)}
                >
                  {Number(day.slice(8))}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {out.slice(0, 3).map((r) => (
                    <li key={r.id} className="bg-brand/10 text-foreground truncate rounded-sm px-1 text-xs">
                      {nameOf(r.employeeId)}
                      {kinds ? `, ${KIND_LABEL[r.kind]}` : ", Out"}
                    </li>
                  ))}
                  {out.length > 3 ? <li className="text-muted-foreground text-xs">{out.length - 3} more</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </ScrollRegion>
    </Panel>
  );
}
