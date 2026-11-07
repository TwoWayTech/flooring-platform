"use client";

import { useState } from "react";
import { BellRing, Building2, CalendarPlus, ChevronLeft, ChevronRight, Repeat, Truck, UserRound } from "lucide-react";
import { addDays, meetingOccurrences, mondayOf, type Attendee, type MeetingOccurrence } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { NewMeetingDialog, RECURRENCE } from "./new-meeting-dialog";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ATTENDEE_ICON = { staff: UserRound, customer: Building2, supplier: Truck } as const;

/** "9:00 AM" from an ISO date-time. */
function timeOf(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function AttendeeChip({ attendee }: { attendee: Attendee }) {
  const Icon = ATTENDEE_ICON[attendee.kind];
  return (
    <li className="bg-raised inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs">
      <Icon aria-hidden="true" className="text-muted-foreground size-3.5" />
      {attendee.name}
      {attendee.kind !== "staff" ? <span className="text-muted-foreground">({attendee.kind})</span> : null}
    </li>
  );
}

/**
 * Meetings (spec Tier 2): a week calendar of meetings with staff, customers and suppliers,
 * recurring meetings expanded into their dates, and reminders.
 */
export function MeetingsPage() {
  const can = useCan();
  const formatDate = useFormatDate();
  const [week, setWeek] = useState(mondayOf(api.today()));
  const [open, setOpen] = useState<MeetingOccurrence | null>(null);
  const [creating, setCreating] = useState(false);
  const data = useApiQuery(async (client) => {
    const [meetings, users, customers, suppliers] = await Promise.all([
      client.list("meetings"),
      client.list("users"),
      client.list("customers"),
      client.list("suppliers"),
    ]);
    return { meetings, users, customers, suppliers };
  }, []);
  if (!can("meetings.meeting.view")) return <NoAccess />;
  const today = api.today();
  const days = DAY_NAMES.map((_, i) => addDays(week, i));
  const occurrences = data.data ? meetingOccurrences(data.data.meetings, days[0]!, days[6]!) : [];

  return (
    <>
      <PageHeader
        title="Meetings"
        actions={
          can("meetings.meeting.create") ? (
            <Button onClick={() => setCreating(true)}>
              <CalendarPlus />
              New meeting
            </Button>
          ) : null
        }
      />
      <Panel
        title={`Week of ${formatDate(week)}`}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => setWeek(addDays(week, -7))}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeek(mondayOf(today))}>
              This week
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
              <ChevronRight />
            </Button>
          </div>
        }
      >
        {data.status !== "ready" ? (
          <Skeleton className="h-64" aria-label="Loading meetings" />
        ) : (
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-7">
            {days.map((day, i) => {
              const items = occurrences.filter((o) => o.start.startsWith(day));
              return (
                <li
                  key={day}
                  className={cn(
                    "flex flex-col gap-2 rounded-md p-2 md:min-h-24",
                    day === today ? "bg-brand-soft/50" : "bg-raised/60",
                  )}
                >
                  <h3 className={cn("text-xs font-medium", day === today ? "text-brand-ink" : "text-muted-foreground")}>
                    {DAY_NAMES[i]} {formatDate(day).replace(/,? \d{4}$/, "")}
                  </h3>
                  {items.length === 0 ? <p className="text-muted-foreground text-xs md:sr-only">No meetings</p> : null}
                  {items.map((o) => (
                    <button
                      key={`${o.meeting.id}-${o.start}`}
                      type="button"
                      onClick={() => setOpen(o)}
                      className="bg-surface border-hairline hover:bg-raised flex flex-col gap-0.5 rounded-sm border p-2 text-left text-xs"
                    >
                      <span className="flex items-center justify-between gap-1 font-medium tabular-nums">
                        {timeOf(o.start)}
                        {o.meeting.recurrence !== "none" ? (
                          <Repeat
                            role="img"
                            aria-label={RECURRENCE[o.meeting.recurrence]}
                            className="text-muted-foreground size-3"
                          />
                        ) : null}
                      </span>
                      <span className="line-clamp-2">{o.meeting.title}</span>
                      <span className="text-muted-foreground truncate">
                        {o.meeting.durationMin} min, {o.meeting.location}
                      </span>
                    </button>
                  ))}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-md">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{open.meeting.title}</SheetTitle>
                <SheetDescription>
                  {formatDate(open.start)}, {timeOf(open.start)} for {open.meeting.durationMin} minutes,{" "}
                  {open.meeting.location}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
                <p className="flex items-center gap-2">
                  <BellRing aria-hidden="true" className="text-brand-ink size-4" />
                  Reminder {open.meeting.reminderMin} minutes before
                </p>
                <p className="flex items-center gap-2">
                  <Repeat aria-hidden="true" className="text-muted-foreground size-4" />
                  {RECURRENCE[open.meeting.recurrence]}
                </p>
                <section aria-labelledby="attendees-title">
                  <h3 id="attendees-title" className="mb-2 font-semibold">
                    Attendees
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {open.meeting.attendees.map((a) => (
                      <AttendeeChip key={`${a.kind}-${a.id}`} attendee={a} />
                    ))}
                  </ul>
                </section>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      {data.data ? (
        <NewMeetingDialog
          open={creating}
          onOpenChange={setCreating}
          users={data.data.users}
          customers={data.data.customers}
          suppliers={data.data.suppliers}
        />
      ) : null}
    </>
  );
}
