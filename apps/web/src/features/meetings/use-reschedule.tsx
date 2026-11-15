"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { MeetingOccurrence, MoveScope, OccurrenceKey } from "@workspace/shared";
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
import type { MeetingMove, MeetingUndo } from "@/lib/api/contract";
import { conflictWarning } from "./conflict-warning";
import { keyOf, movedKey } from "./current-occurrence";
import { scopeChoices, type ScopeChoice } from "./scope-choices";

/** A change waiting for "this event, this and following, or all" (spec F). */
interface Pending {
  occurrence: MeetingOccurrence;
  start: string;
  durationMin: number;
  /** Each scope with the move rules' answer for this drop, worked out once when the dialog opens. */
  choices: ScopeChoice[];
}

/** What the screen hears about a move the server took. */
export interface RescheduleOptions {
  /** The occurrence that moved and the one it became, so an open drawer can follow it (ADR 0051 "Part 3"). */
  onMoved?: (from: OccurrenceKey, to: OccurrenceKey) => void;
}

/**
 * Moves or resizes a meeting from a drag, a resize or the reschedule form (spec F). A one-off moves
 * at once; a repeating meeting first asks which occurrences the change covers, offering only the
 * scopes the shared move rules allow for that drop and saying why each other one is left out
 * (ADR 0051 "Part 3", safest option 6); the server decides again. After the save, guests booked
 * elsewhere then are named in a warning, and every move offers Undo, which sends only the SEQUENCE
 * the screen saw and shows every refusal (safest option 7).
 */
export function useReschedule({ onMoved }: RescheduleOptions = {}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [scope, setScope] = useState<MoveScope>("this");

  function undo(record: MeetingUndo, from: OccurrenceKey, to: OccurrenceKey) {
    api.undoReschedule(record).then(
      () => {
        toast.success("Move undone");
        onMoved?.(to, from);
      },
      (error: unknown) => toast.error(error instanceof Error ? error.message : "The move was not undone."),
    );
  }

  async function save(occurrence: MeetingOccurrence, start: string, durationMin: number, chosen: MoveScope) {
    const move: MeetingMove = {
      meetingId: occurrence.meeting.id,
      planned: occurrence.planned,
      start,
      durationMin,
      scope: chosen,
    };
    try {
      const answer = await api.rescheduleMeeting(move);
      const from = keyOf(occurrence);
      const to = movedKey(move, answer, occurrence.meeting);
      toast.success(`${occurrence.meeting.title} moved`, {
        action: { label: "Undo", onClick: () => undo(answer.undo, from, to) },
      });
      const warning = conflictWarning(answer.conflicts);
      if (warning) toast.warning(warning);
      onMoved?.(from, to);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The meeting was not moved.");
    }
  }

  /** Starts a move; recurring meetings ask for the scope first. */
  function reschedule(occurrence: MeetingOccurrence, start: string, durationMin: number) {
    if (start === occurrence.start && durationMin === occurrence.durationMin) return;
    if (occurrence.meeting.recurrence === "none") return void save(occurrence, start, durationMin, "all");
    const choices = scopeChoices(occurrence, start, durationMin, api.today(), new Date());
    const open = choices.filter((c) => c.problem === null);
    setScope((open.find((c) => c.scope === "this") ?? open[0])?.scope ?? "this");
    setPending({ occurrence, start, durationMin, choices });
  }

  const offered = pending?.choices.filter((c) => c.problem === null) ?? [];
  const refused = pending?.choices.filter((c) => c.problem !== null) ?? [];
  const dialog = pending ? (
    <Dialog open onOpenChange={(o) => !o && setPending(null)}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move a repeating meeting</DialogTitle>
          <DialogDescription>
            {offered.length > 0
              ? `${pending.occurrence.meeting.title} repeats. Which events move?`
              : `${pending.occurrence.meeting.title} repeats, and no events can move to that time.`}
          </DialogDescription>
        </DialogHeader>
        {offered.length > 0 ? (
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as MoveScope)} aria-label="Which events move">
            {offered.map((c) => (
              <label key={c.scope} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={c.scope} />
                {c.label}
              </label>
            ))}
          </RadioGroup>
        ) : null}
        {refused.length > 0 ? (
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm" aria-label="Not available for this move">
            {refused.map((c) => (
              <li key={c.scope}>
                {c.label}: {c.problem}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          {offered.length > 0 ? (
            <Button
              onClick={() => {
                const p = pending;
                setPending(null);
                void save(p.occurrence, p.start, p.durationMin, scope);
              }}
            >
              Move
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { reschedule, dialog };
}
