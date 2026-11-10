"use client";

import { useState } from "react";
import { BellRing, CalendarPlus, ChevronLeft, ChevronRight, Globe, Repeat } from "lucide-react";
import { addDays, meetingOccurrences, mondayOf, type MeetingOccurrence } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Segmented } from "@workspace/ui/components/segmented";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { MeetingAnswers, RequestMeetingDialog } from "./meeting-answers";
import { NewMeetingDialog, RECURRENCE } from "./new-meeting-dialog";
import { RescheduleForm } from "./reschedule-form";
import { timeOf, TimeGrid } from "./time-grid";
import { useReschedule } from "./use-reschedule";

type View = "day" | "week" | "month" | "agenda";
const VIEWS: (readonly [View, string])[] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["agenda", "Agenda"],
];
/** How far Previous and Next go, and what they are called, per view. */
const STEP: Record<View, { days: number; noun: string }> = {
  day: { days: 1, noun: "day" },
  week: { days: 7, noun: "week" },
  month: { days: 0, noun: "month" },
  agenda: { days: 7, noun: "week" },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The first day of the month a date is in, and of the month after. */
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
function shiftMonth(iso: string, by: number) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Meetings (spec Tier 2, F): day, week, month and agenda views of meetings with staff, customers
 * and suppliers. Drag a meeting to move it, drag its edge to change its length, click an empty
 * slot to schedule; a repeating meeting asks this event, this and following, or all. Conflicts
 * are named, every move has Undo, and the drawer's Reschedule form does the same by keyboard.
 */
export function MeetingsPage() {
  const can = useCan();
  const formatDate = useFormatDate();
  const today = api.today();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<MeetingOccurrence | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const { reschedule, dialog } = useReschedule();
  const data = useApiQuery(async (client) => {
    const [meetings, users, customers, suppliers, contacts, supplierContacts] = await Promise.all([
      client.list("meetings"),
      client.list("users"),
      client.list("customers"),
      client.list("suppliers"),
      client.list("customerContacts"),
      client.list("supplierContacts"),
    ]);
    return { meetings, users, customers, suppliers, contacts, supplierContacts };
  }, []);
  if (!can("meetings.meeting.view")) return <NoAccess />;
  const canEdit = can("meetings.meeting.edit");

  const week = mondayOf(anchor);
  const days = view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const monthStart = monthOf(anchor);
  const gridStart = mondayOf(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const range =
    view === "month"
      ? [gridStart, monthDays[41]!]
      : view === "agenda"
        ? [anchor, addDays(anchor, 29)]
        : [days[0]!, days.at(-1)!];
  const occurrences = data.data ? meetingOccurrences(data.data.meetings, range[0]!, range[1]!) : [];
  const step = STEP[view];
  const go = (by: number) => setAnchor(view === "month" ? shiftMonth(anchor, by) : addDays(anchor, by * step.days));
  const title =
    view === "day"
      ? formatDate(anchor)
      : view === "month"
        ? new Date(`${monthStart}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })
        : view === "agenda"
          ? `Next 30 days from ${formatDate(anchor)}`
          : `Week of ${formatDate(week)}`;
  const shortDay = (day: string) =>
    `${WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]} ${formatDate(day).replace(/,? \d{4}$/, "")}`;
  const current = open
    ? (occurrences.find((o) => o.meeting.id === open.meeting.id && o.planned === open.planned) ?? open)
    : null;

  return (
    <>
      <PageHeader
        title="Meetings"
        actions={
          can("meetings.meeting.create") ? (
            <>
              <Button variant="outline" onClick={() => setRequesting(true)}>
                Request a meeting
              </Button>
              <Button onClick={() => setCreating(`${today}T09:00`)}>
                <CalendarPlus />
                New meeting
              </Button>
            </>
          ) : null
        }
      />
      <Panel
        title={title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Calendar view" value={view} options={VIEWS} onChange={(v) => setView(v as View)} />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label={`Previous ${step.noun}`} onClick={() => go(-1)}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>
                Today
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Next ${step.noun}`} onClick={() => go(1)}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        }
      >
        {data.status !== "ready" ? (
          <QueryFallback query={data} className="h-64" label="Loading meetings" />
        ) : view === "day" || view === "week" ? (
          <TimeGrid
            days={days}
            occurrences={occurrences}
            today={today}
            canEdit={canEdit}
            onOpen={setOpen}
            onMove={reschedule}
            onCreate={(start) => can("meetings.meeting.create") && setCreating(start)}
            dayLabel={shortDay}
          />
        ) : view === "month" ? (
          <ol className="grid grid-cols-7 gap-px text-xs" aria-label={title}>
            {monthDays.map((day) => {
              const items = occurrences.filter((o) => o.start.startsWith(day));
              return (
                <li
                  key={day}
                  className={cn(
                    "bg-raised/60 flex min-h-20 flex-col gap-1 p-1",
                    day.slice(0, 7) !== monthStart.slice(0, 7) && "opacity-50",
                    day === today && "bg-brand-soft/50",
                  )}
                >
                  <span className={cn("font-medium", day === today ? "text-brand-ink" : "text-muted-foreground")}>
                    {Number(day.slice(8))}
                  </span>
                  {items.map((o) => (
                    <button
                      key={`${o.meeting.id}-${o.planned}`}
                      type="button"
                      onClick={() => setOpen(o)}
                      className="bg-surface hover:bg-raised truncate rounded-sm px-1 text-left"
                    >
                      {timeOf(o.start)} {o.meeting.title}
                    </button>
                  ))}
                </li>
              );
            })}
          </ol>
        ) : (
          <ol className="flex flex-col gap-4">
            {[...new Set(occurrences.map((o) => o.start.slice(0, 10)))].map((day) => (
              <li key={day}>
                <h3 className="text-muted-foreground mb-1 text-xs font-medium">{shortDay(day)}</h3>
                <ul className="flex flex-col gap-1">
                  {occurrences
                    .filter((o) => o.start.startsWith(day))
                    .map((o) => (
                      <li key={`${o.meeting.id}-${o.planned}`}>
                        <button
                          type="button"
                          onClick={() => setOpen(o)}
                          className="hover:bg-raised flex w-full gap-3 rounded-sm px-2 py-1.5 text-left text-sm"
                        >
                          <span className="w-20 shrink-0 tabular-nums">{timeOf(o.start)}</span>
                          <span className="flex-1">{o.meeting.title}</span>
                          <span className="text-muted-foreground">{o.durationMin} min</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
            {occurrences.length === 0 ? (
              <p className="text-muted-foreground text-sm">No meetings in the next 30 days.</p>
            ) : null}
          </ol>
        )}
      </Panel>
      <Sheet open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-md">
          {current ? (
            <>
              <SheetHeader>
                <SheetTitle>{current.meeting.title}</SheetTitle>
                <SheetDescription>
                  {formatDate(current.start.slice(0, 10))}, {timeOf(current.start)} for {current.durationMin} minutes,{" "}
                  {current.meeting.location}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
                <p className="flex items-center gap-2">
                  <BellRing aria-hidden="true" className="text-brand-ink size-4" />
                  Reminder {current.meeting.reminderMin} minutes before
                </p>
                <p className="flex items-center gap-2">
                  <Repeat aria-hidden="true" className="text-muted-foreground size-4" />
                  {RECURRENCE[current.meeting.recurrence]}
                </p>
                <p className="flex items-center gap-2">
                  <Globe aria-hidden="true" className="text-muted-foreground size-4" />
                  Times in {current.meeting.timeZone.replace("_", " ")}
                </p>
                <MeetingAnswers meeting={current.meeting} />
                {canEdit && current.meeting.status !== "cancelled" ? (
                  <RescheduleForm
                    key={`${current.meeting.id}-${current.planned}`}
                    occurrence={current}
                    onSubmit={(start, minutes) => reschedule(current, start, minutes)}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      {data.data && creating ? (
        <NewMeetingDialog
          key={creating}
          open
          onOpenChange={(o) => !o && setCreating(null)}
          users={data.data.users}
          customers={data.data.customers}
          contacts={data.data.contacts}
          suppliers={data.data.suppliers}
          supplierContacts={data.data.supplierContacts}
          initialStart={creating}
        />
      ) : null}
      {data.data && requesting ? (
        <RequestMeetingDialog users={data.data.users} onClose={() => setRequesting(false)} />
      ) : null}
      {dialog}
    </>
  );
}
