import { moveProblem, type MeetingOccurrence, type MoveScope } from "@workspace/shared";

/** One answer to "which events move", with the move rule's own reason when it is refused. */
export interface ScopeChoice {
  scope: MoveScope;
  label: string;
  /** Why the move rules refuse this scope for this drop, in their own words, or null when it may be chosen. */
  problem: string | null;
}

const SCOPES: readonly { scope: MoveScope; label: string }[] = [
  { scope: "this", label: "This event" },
  { scope: "following", label: "This and following events" },
  { scope: "all", label: "All events" },
];

/**
 * The scopes a repeating meeting's move dialog offers for one drop (ADR 0051 "Part 3", safest
 * option 6): each is checked with the shared `moveProblem`, the rule the server runs, so a scope the
 * rules refuse (for example "this and following" from the first occurrence, or "all" from an
 * occurrence changed on its own) is left out with that rule's reason. `today` and `now` are the
 * browser's, so near the start bound the server may still decide otherwise (risk R8).
 */
export function scopeChoices(
  occurrence: MeetingOccurrence,
  start: string,
  durationMin: number,
  today: string,
  now: Date,
): ScopeChoice[] {
  return SCOPES.map(({ scope, label }) => ({
    scope,
    label,
    problem: moveProblem(occurrence.meeting, { planned: occurrence.planned, start, durationMin, scope }, today, now),
  }));
}
