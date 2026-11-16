import { sameWeekHours, type Timesheet } from "@workspace/shared";

/**
 * My timesheet's week form (employee-portal.md "Weekly hours"; ADR 0051, "Re-reading after every
 * write", 2026-11-16): the saved hours it started from (`base`), the text typed in each day, and
 * newer saved hours waiting for the person's choice. Every save sends `base` as `expectedDays`, so
 * the server refuses a save made from hours that changed meanwhile (hr.md "Create or edit hours").
 */
export interface WeekHours {
  base: readonly number[];
  typed: readonly string[];
  newer: readonly number[] | null;
}

const NO_HOURS: readonly number[] = [0, 0, 0, 0, 0, 0, 0];

/** What the form needs from one read of the week, or from its own save's answer; undefined: no sheet. */
export type WeekRead = Pick<Timesheet, "status" | "days"> | undefined;

/** Whether the form only shows the week's saved hours: submitted or approved, so locked. */
export function weekLocked(sheet: WeekRead): boolean {
  return sheet?.status === "approved" || sheet?.status === "submitted";
}

/**
 * One read of the week as the form remembers it: locked or not, and the saved hours. The form takes
 * each new read once (`serverHours`), and its own save's answer counts as one (`hoursSaved`), so any
 * later read that differs from that answer is taken or asked about, even one back at the hours the
 * form opened with (review round 1 of PR #44).
 */
export function readKey(sheet: WeekRead): string {
  return `${weekLocked(sheet)}|${sheet?.days.join(",") ?? ""}`;
}

/**
 * One day's typed text as hours: the save's own reading, so "", "." and a mistyped "7..5" are 0
 * and "7." is 7. The form compares and saves only these numbers, never the text, because decimal.js
 * throws on half-typed hours.
 */
export function parseHours(text: string): number {
  return Number(text) || 0;
}

/** A form showing a week's saved hours, or zeros for a week with no sheet. */
export function weekHours(days?: readonly number[]): WeekHours {
  const base = days ?? NO_HOURS;
  return { base, typed: base.map(String), newer: null };
}

/** The form after the person types in one day; only digits and dots are kept. */
export function typeHours(state: WeekHours, day: number, text: string): WeekHours {
  const clean = text.replace(/[^\d.]/g, "");
  return { ...state, typed: state.typed.map((value, at) => (at === day ? clean : value)) };
}

/** The typed hours as numbers, for the total and the save. */
export function typedHours(state: WeekHours): number[] {
  return state.typed.map(parseHours);
}

/**
 * The form after the week is read again with these saved hours (undefined: no sheet, so zeros). A
 * submitted or approved week shows what is saved. Otherwise, in order:
 * - saved hours equal to the typed ones (the person's own save) become the base, and the text stays
 *   as typed, so "7." isn't rewritten under the cursor;
 * - saved hours equal to the base change nothing and clear any notice;
 * - a form with no edits takes the saved hours;
 * - a form with edits keeps them, and the saved hours wait for the person's choice.
 */
export function serverHours(state: WeekHours, days: readonly number[] | undefined, locked: boolean): WeekHours {
  const saved = days ?? NO_HOURS;
  if (locked) return weekHours(saved);
  const typed = typedHours(state);
  if (sameWeekHours(saved, typed)) return { ...state, base: saved, newer: null };
  if (sameWeekHours(saved, state.base)) return { ...state, newer: null };
  if (sameWeekHours(typed, state.base)) return weekHours(saved);
  return { ...state, newer: saved };
}

/**
 * The form after the person's own save of `sent`. Its 200 means the server held exactly those hours
 * (it wrote them, or already had them), so they become the base. The answer is then taken like any
 * read: hours another writer saved since are taken by a form with no edits and asked about by one
 * with edits, never made the base while the form shows other hours, so the next save can't replace
 * them unseen (review round 1 of PR #44).
 */
export function hoursSaved(state: WeekHours, sent: readonly number[], answer: NonNullable<WeekRead>): WeekHours {
  return serverHours({ ...state, base: sent }, answer.days, weekLocked(answer));
}

/** "Use saved hours": the newer saved hours replace what was typed. */
export function takeSavedHours(state: WeekHours): WeekHours {
  return state.newer ? weekHours(state.newer) : state;
}

/** "Keep my hours": the typed hours stay, and the next save replaces the newer saved ones on purpose. */
export function keepTypedHours(state: WeekHours): WeekHours {
  return state.newer ? { ...state, base: state.newer, newer: null } : state;
}

/**
 * What Save sends: the typed hours, and the hours the form started from as `expectedDays`. Null
 * while newer saved hours wait for the person's choice, so nothing is saved over them unseen.
 */
export function saveInput(state: WeekHours): { days: number[]; expectedDays: number[] } | null {
  return state.newer ? null : { days: typedHours(state), expectedDays: [...state.base] };
}
