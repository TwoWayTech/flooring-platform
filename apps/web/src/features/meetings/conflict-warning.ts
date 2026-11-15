import type { Conflict } from "@workspace/shared";
import { timeOf } from "./time-text";

/**
 * The warning after a move (meetings.md rule 13): each guest already booked then, with the other
 * meeting's title as the server gave it and that meeting's start. A meeting the mover can't read
 * comes as "Busy" (ADR 0051 "Part 2"), and the screen never fills in a title from anything else it
 * holds. Null when nobody is double-booked.
 */
export function conflictWarning(conflicts: readonly Conflict[]): string | null {
  if (conflicts.length === 0) return null;
  return `Also booked then: ${conflicts.map((c) => `${c.name} (${c.title}, ${timeOf(c.start)})`).join(", ")}`;
}
