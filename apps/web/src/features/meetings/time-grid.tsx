"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Repeat } from "lucide-react";
import { addDays, type MeetingOccurrence } from "@workspace/shared";
import { cn } from "@workspace/ui/lib/utils";
import { RECURRENCE } from "./new-meeting-dialog";

/** The hours the grid shows, and how tall an hour is. */
const FIRST_HOUR = 7;
const LAST_HOUR = 19;
const HOUR_PX = 48;
/** Moves and resizes snap to a quarter hour. */
const SNAP_MIN = 15;

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const at = (day: string, minutes: number) =>
  `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "9:00 AM" from an ISO date-time. */
export function timeOf(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Side-by-side lanes for meetings that overlap on one day, so none hides another: each takes the
 * first lane free at its start, and shares the width with the lanes in use alongside it.
 */
function lanes(items: readonly MeetingOccurrence[]): Map<MeetingOccurrence, { lane: number; of: number }> {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const ends: number[] = [];
  const placed = new Map<MeetingOccurrence, { lane: number; of: number }>();
  let group: MeetingOccurrence[] = [];
  let groupEnd = -1;
  const close = () =>
    group.forEach((o) => (placed.get(o)!.of = Math.max(1, ...group.map((g) => placed.get(g)!.lane + 1))));
  for (const o of sorted) {
    const start = minutesOf(o.start);
    if (start >= groupEnd) {
      close();
      group = [];
      ends.length = 0;
    }
    let lane = ends.findIndex((end) => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = start + o.durationMin;
    placed.set(o, { lane, of: 1 });
    group.push(o);
    groupEnd = Math.max(groupEnd, start + o.durationMin);
  }
  close();
  return placed;
}

/** A drag in progress: which occurrence, what it does, and how far the pointer has gone. */
interface Drag {
  occurrence: MeetingOccurrence;
  mode: "move" | "resize";
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** The width of one day column when the drag began, to turn sideways movement into days. */
  columnPx: number;
}

/**
 * Day or week time grid (spec F): meetings sit at their time and length; drag one to move it
 * (to another day in the week), drag its bottom edge to change its length, click an empty slot to
 * schedule there. Moves snap to 15 minutes. A press without movement opens the meeting, so every
 * meeting is also reachable by keyboard and screen reader as a plain button.
 */
export function TimeGrid({
  days,
  occurrences,
  today,
  canEdit,
  onOpen,
  onMove,
  onCreate,
  dayLabel,
}: {
  days: string[];
  occurrences: MeetingOccurrence[];
  today: string;
  canEdit: boolean;
  onOpen: (o: MeetingOccurrence) => void;
  onMove: (o: MeetingOccurrence, start: string, durationMin: number) => void;
  onCreate: (start: string) => void;
  dayLabel: (day: string) => string;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);

  /** Where a drag would land: the new start and length. */
  function landing(d: Drag): { start: string; durationMin: number } {
    const startMin = minutesOf(d.occurrence.start);
    const delta = snap((d.dy / HOUR_PX) * 60);
    if (d.mode === "resize")
      return { start: d.occurrence.start, durationMin: Math.max(SNAP_MIN, d.occurrence.durationMin + delta) };
    const dayShift = days.length > 1 ? Math.round(d.dx / d.columnPx) : 0;
    const day = addDays(d.occurrence.start.slice(0, 10), dayShift);
    const minutes = Math.min(Math.max(FIRST_HOUR * 60, startMin + delta), LAST_HOUR * 60 - SNAP_MIN);
    return { start: at(day, minutes), durationMin: d.occurrence.durationMin };
  }

  function begin(event: ReactPointerEvent, occurrence: MeetingOccurrence, mode: Drag["mode"]) {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const columnPx = grid.current ? grid.current.clientWidth / days.length : 1;
    setDrag({ occurrence, mode, x: event.clientX, y: event.clientY, dx: 0, dy: 0, columnPx });
  }

  function move(event: ReactPointerEvent) {
    if (drag) setDrag({ ...drag, dx: event.clientX - drag.x, dy: event.clientY - drag.y });
  }

  function end(occurrence: MeetingOccurrence) {
    const d = drag;
    setDrag(null);
    if (!d) return onOpen(occurrence);
    if (Math.abs(d.dx) < 4 && Math.abs(d.dy) < 4) return onOpen(occurrence);
    const target = landing(d);
    onMove(d.occurrence, target.start, target.durationMin);
  }

  return (
    <div className="flex min-w-0 overflow-x-auto">
      <div className="text-muted-foreground w-14 shrink-0 pt-8 text-right text-xs" aria-hidden="true">
        {hours.map((h) => (
          <div key={h} style={{ height: HOUR_PX }} className="pr-2">
            {h % 12 === 0 ? 12 : h % 12} {h < 12 ? "AM" : "PM"}
          </div>
        ))}
      </div>
      <div
        ref={grid}
        className="grid min-w-[36rem] flex-1"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((day) => (
          <div key={day} className="border-hairline border-l">
            <h3
              className={cn(
                "h-8 px-2 py-1.5 text-xs font-medium",
                day === today ? "text-brand-ink" : "text-muted-foreground",
              )}
            >
              {dayLabel(day)}
            </h3>
            <div
              className={cn("relative", day === today && "bg-brand-soft/30")}
              style={{ height: hours.length * HOUR_PX }}
            >
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={!canEdit}
                  onClick={() => onCreate(at(day, h * 60))}
                  className="border-hairline hover:bg-raised/60 block w-full border-t"
                  style={{ height: HOUR_PX }}
                />
              ))}
              {(() => {
                const items = occurrences.filter((o) => o.start.startsWith(day));
                const placed = lanes(items);
                return items.map((o) => {
                  const place = placed.get(o)!;
                  const dragging = drag?.occurrence === o;
                  const shown = dragging ? landing(drag) : { start: o.start, durationMin: o.durationMin };
                  const top = ((minutesOf(shown.start) - FIRST_HOUR * 60) / 60) * HOUR_PX;
                  const height = Math.max(20, (shown.durationMin / 60) * HOUR_PX);
                  const dayShift =
                    dragging && drag.mode === "move" && days.length > 1 ? Math.round(drag.dx / drag.columnPx) : 0;
                  return (
                    <div
                      key={`${o.meeting.id}-${o.planned}`}
                      className={cn(
                        "bg-surface border-chart-1 absolute overflow-hidden rounded-sm border border-l-4 text-xs shadow-sm",
                        dragging && "ring-ring z-10 ring-2",
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${(place.lane / place.of) * 100}% + 2px)`,
                        width: `calc(${100 / place.of}% - 4px)`,
                        transform: dayShift ? `translateX(${dayShift * place.of * 100}%)` : undefined,
                      }}
                    >
                      <button
                        type="button"
                        className="flex h-full w-full touch-none flex-col items-start gap-0.5 p-1.5 text-left"
                        onPointerDown={(e) => begin(e, o, "move")}
                        onPointerMove={move}
                        onPointerUp={() => end(o)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(o))}
                        aria-label={`${o.meeting.title}, ${timeOf(o.start)}, ${o.durationMin} minutes`}
                      >
                        <span className="flex w-full items-center justify-between gap-1 font-medium tabular-nums">
                          {timeOf(shown.start)}
                          {o.meeting.recurrence !== "none" ? (
                            <Repeat
                              role="img"
                              aria-label={RECURRENCE[o.meeting.recurrence]}
                              className="text-muted-foreground size-3"
                            />
                          ) : null}
                        </span>
                        <span className="line-clamp-2">{o.meeting.title}</span>
                      </button>
                      {canEdit ? (
                        <span
                          aria-hidden="true"
                          onPointerDown={(e) => begin(e, o, "resize")}
                          onPointerMove={move}
                          onPointerUp={() => end(o)}
                          data-resize
                          className="hover:bg-chart-1/30 absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none"
                        />
                      ) : null}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
