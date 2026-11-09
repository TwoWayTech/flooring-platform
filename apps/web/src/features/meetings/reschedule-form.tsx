"use client";

import { useState, type FormEvent } from "react";
import type { MeetingOccurrence } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Field } from "@/components/field";

/**
 * Reschedule with fields instead of dragging (spec F: a keyboard and form alternative): date,
 * start time and length. A repeating meeting then asks which events move.
 */
export function RescheduleForm({
  occurrence,
  onSubmit,
}: {
  occurrence: MeetingOccurrence;
  onSubmit: (start: string, durationMin: number) => void;
}) {
  const [date, setDate] = useState(occurrence.start.slice(0, 10));
  const [time, setTime] = useState(occurrence.start.slice(11, 16));
  const [duration, setDuration] = useState(String(occurrence.durationMin));

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(`${date}T${time}`, Math.max(15, Number(duration) || occurrence.durationMin));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Reschedule">
      <h3 className="font-semibold">Reschedule</h3>
      <div className="grid grid-cols-3 gap-2">
        <Field id="move-date" label="Date">
          <Input id="move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="move-time" label="Start">
          <Input id="move-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field id="move-duration" label="Minutes">
          <Input
            id="move-duration"
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" variant="outline" className="self-start">
        Move meeting
      </Button>
    </form>
  );
}
