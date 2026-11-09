import { attendeeConflicts, moveOccurrence, type Meeting } from "@workspace/shared";
import type { MeetingMove, MeetingUndo } from "../contract";
import { DemoRuleError } from "./admin-rules";
import type { ActionContext } from "./payment-actions";

/**
 * Moves or resizes a meeting occurrence (spec F): this one, this and following, or all. Times stay
 * in the meeting's own time zone and reminders follow the new start. Returns the saved meetings,
 * the attendee conflicts at the new time, and what Undo puts back.
 */
export async function rescheduleMeeting(ctx: ActionContext, move: MeetingMove) {
  await ctx.assertCan(["meetings.meeting.edit"]);
  const meeting = ctx.db.get("meetings", move.meetingId);
  if (!meeting) throw new DemoRuleError("This meeting no longer exists.");
  if (move.durationMin < 15) throw new DemoRuleError("A meeting lasts at least 15 minutes.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(move.start)) throw new DemoRuleError("Enter a date and a start time.");
  const saved = moveOccurrence(
    meeting,
    move.planned,
    { start: move.start, durationMin: move.durationMin },
    move.scope,
    ctx.newId("mtg"),
  );
  for (const m of saved) ctx.db.put("meetings", m);
  const conflicts = attendeeConflicts(ctx.db.list("meetings"), {
    meetingId: meeting.id,
    planned: move.planned,
    start: move.start,
    durationMin: move.durationMin,
    attendees: meeting.attendees,
  });
  ctx.audit({
    category: "data",
    action: "Moved meeting",
    target: meeting.title,
    before: move.planned.replace("T", " "),
    after: `${move.start.replace("T", " ")}, ${move.durationMin} min (${move.scope === "this" ? "this event" : move.scope === "following" ? "this and following" : "all"})`,
  });
  const undo: MeetingUndo = {
    previous: meeting,
    createdIds: saved.filter((m) => m.id !== meeting.id).map((m) => m.id),
  };
  return { meetings: saved, conflicts, undo };
}

/** Puts a meeting back as it was before a move, removing a series the move split off. */
export async function undoReschedule(ctx: ActionContext, undo: MeetingUndo): Promise<Meeting> {
  await ctx.assertCan(["meetings.meeting.edit"]);
  for (const id of undo.createdIds) ctx.db.remove("meetings", id);
  ctx.db.put("meetings", undo.previous);
  ctx.audit({
    category: "data",
    action: "Undid meeting move",
    target: undo.previous.title,
    before: null,
    after: undo.previous.start.replace("T", " "),
  });
  return undo.previous;
}
