"use client";

import { useState } from "react";
import { toast } from "sonner";
import { moveKind, type MeetingOccurrence, type MoveScope, type OccurrenceKey } from "@workspace/shared";
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
import { moveWords, UNDO_TOAST_MS, type MoveWords } from "./move-words";
import { scopeChoices, type ScopeChoice } from "./scope-choices";

/** A change waiting for "this event, this and following, or all" (spec F). */
interface Pending {
  occurrence: MeetingOccurrence;
  start: string;
  durationMin: number;
  /** Each scope with the move rules' answer for this drop, worked out once when the dialog opens. */
  choices: ScopeChoice[];
  /** A move or a resize, in words. */
  words: MoveWords;
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
 * (ADR 0051 "Part 3", safest option 6); the server decides again. A change that keeps the start is
 * a resize and is worded as one in the dialog and the toast (`moveKind`; click-through #44). After
 * the save, the toast offers Undo for `UNDO_TOAST_MS`, which sends only the SEQUENCE the screen saw
 * and shows every refusal (safest option 7), and names in a warning the guests booked elsewhere then.
 */
export function useReschedule({ onMoved }: RescheduleOptions = {}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [scope, setScope] = useState<MoveScope>("this");

  function undo(record: MeetingUndo, from: OccurrenceKey, to: OccurrenceKey, words: MoveWords) {
    api.undoReschedule(record).then(
      () => {
        toast.success(words.undone);
        onMoved?.(to, from);
      },
      (error: unknown) => toast.error(error instanceof Error ? error.message : words.undoFailed),
    );
  }

  async function save(
    occurrence: MeetingOccurrence,
    start: string,
    durationMin: number,
    chosen: MoveScope,
    words: MoveWords,
  ) {
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
      // One toast per move: a conflict warning comes with the move's own Undo, so a second toast never
      // stacks over the Undo just when a clash makes it most wanted (spec F, "Move or resize"). The
      // toast takes the pointer back, since the meeting drawer, a modal, turns it off outside itself,
      // and it stays long enough to reach Undo (#44).
      const shown = {
        action: { label: "Undo", onClick: () => undo(answer.undo, from, to, words) },
        className: "pointer-events-auto",
        duration: UNDO_TOAST_MS,
      };
      const done = words.done(occurrence.meeting.title, durationMin);
      const warning = conflictWarning(answer.conflicts);
      if (warning) toast.warning(done, { ...shown, description: warning });
      else toast.success(done, shown);
      onMoved?.(from, to);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : words.failed);
    }
  }

  /** Starts a move or a resize; recurring meetings ask for the scope first. */
  function reschedule(occurrence: MeetingOccurrence, start: string, durationMin: number) {
    if (start === occurrence.start && durationMin === occurrence.durationMin) return;
    const words = moveWords(moveKind(occurrence, { start, durationMin }));
    if (occurrence.meeting.recurrence === "none") return void save(occurrence, start, durationMin, "all", words);
    const choices = scopeChoices(occurrence, start, durationMin, api.today(), new Date());
    const open = choices.filter((c) => c.problem === null);
    setScope((open.find((c) => c.scope === "this") ?? open[0])?.scope ?? "this");
    setPending({ occurrence, start, durationMin, choices, words });
  }

  const offered = pending?.choices.filter((c) => c.problem === null) ?? [];
  const refused = pending?.choices.filter((c) => c.problem !== null) ?? [];
  const dialog = pending ? (
    <Dialog open onOpenChange={(o) => !o && setPending(null)}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{pending.words.dialogTitle}</DialogTitle>
          <DialogDescription>
            {offered.length > 0
              ? pending.words.question(pending.occurrence.meeting.title)
              : pending.words.noneOpen(pending.occurrence.meeting.title)}
          </DialogDescription>
        </DialogHeader>
        {offered.length > 0 ? (
          <RadioGroup
            value={scope}
            onValueChange={(v) => setScope(v as MoveScope)}
            aria-label={pending.words.scopeLabel}
          >
            {offered.map((c) => (
              <label key={c.scope} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={c.scope} />
                {c.label}
              </label>
            ))}
          </RadioGroup>
        ) : null}
        {refused.length > 0 ? (
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm" aria-label={pending.words.refusedLabel}>
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
                void save(p.occurrence, p.start, p.durationMin, scope, p.words);
              }}
            >
              {pending.words.confirm}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { reschedule, dialog };
}
