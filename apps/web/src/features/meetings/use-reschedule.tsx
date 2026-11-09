"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { MeetingOccurrence, MoveScope } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { api } from "@/lib/api";

/** A change waiting for "this event, this and following, or all" (spec F). */
interface Pending {
  occurrence: MeetingOccurrence;
  start: string;
  durationMin: number;
}

const SCOPES: { value: MoveScope; label: string }[] = [
  { value: "this", label: "This event" },
  { value: "following", label: "This and following events" },
  { value: "all", label: "All events" },
];

/**
 * Moves or resizes a meeting from a drag, a resize or the reschedule form (spec F): a recurring
 * meeting first asks which occurrences the change covers. After the save, attendee conflicts at
 * the new time are named in a warning, and every move offers Undo.
 */
export function useReschedule() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [scope, setScope] = useState<MoveScope>("this");

  async function save(p: Pending, chosen: MoveScope) {
    try {
      const { conflicts, undo } = await api.rescheduleMeeting({
        meetingId: p.occurrence.meeting.id,
        planned: p.occurrence.planned,
        start: p.start,
        durationMin: p.durationMin,
        scope: chosen,
      });
      toast.success(`${p.occurrence.meeting.title} moved`, {
        action: {
          label: "Undo",
          onClick: () => void api.undoReschedule(undo).then(() => toast.success("Move undone")),
        },
      });
      if (conflicts.length) {
        toast.warning(`Also booked then: ${conflicts.map((c) => `${c.name} (${c.title})`).join(", ")}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The meeting was not moved.");
    }
  }

  /** Starts a move; recurring meetings ask for the scope first. */
  function reschedule(occurrence: MeetingOccurrence, start: string, durationMin: number) {
    if (start === occurrence.start && durationMin === occurrence.durationMin) return;
    const p = { occurrence, start, durationMin };
    if (occurrence.meeting.recurrence === "none") return void save(p, "all");
    setScope("this");
    setPending(p);
  }

  const dialog = pending ? (
    <Dialog open onOpenChange={(o) => !o && setPending(null)}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move a repeating meeting</DialogTitle>
          <DialogDescription>{pending.occurrence.meeting.title} repeats. Which events move?</DialogDescription>
        </DialogHeader>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as MoveScope)} aria-label="Which events move">
          {SCOPES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={s.value} />
              {s.label}
            </label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const p = pending;
              setPending(null);
              void save(p, scope);
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { reschedule, dialog };
}
