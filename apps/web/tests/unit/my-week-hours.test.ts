import { describe, expect, it } from "vitest";
import {
  hoursSaved,
  keepTypedHours,
  parseHours,
  saveInput,
  serverHours,
  takeSavedHours,
  typedHours,
  typeHours,
  weekHours,
  type WeekHours,
} from "@/features/my/week-hours";

/**
 * My timesheet's week form (employee-portal.md "Weekly hours"; ADR 0051, 2026-11-16): newer saved
 * hours replace a form with no edits, and wait for a choice on a form with edits, so a save never
 * sends old hours as if they were current.
 */

/** A week with Monday's hours set and the rest zero. */
const week = (monday: number) => [monday, 0, 0, 0, 0, 0, 0];

/** The form after typing Monday's hours. */
const typedMonday = (state: WeekHours, text: string) => typeHours(state, 0, text);

describe("My timesheet's week form", () => {
  it("(a) takes an upload's hours into a form with no edits, and saves from them", () => {
    const form = serverHours(weekHours(week(6.5)), week(7), false);
    expect(form).toEqual(weekHours(week(7)));
    expect(saveInput(form)).toEqual({ days: week(7), expectedDays: week(7) });
  });

  it("(b) keeps typed hours when newer ones arrive, and saves nothing until the person chooses", () => {
    const form = serverHours(typedMonday(weekHours(week(6.5)), "9"), week(7), false);
    expect(form.typed[0]).toBe("9");
    expect(form.newer).toEqual(week(7));
    expect(saveInput(form)).toBeNull();
  });

  it("(c) uses the saved hours, or keeps the typed ones over them, as the person chooses", () => {
    const asking = serverHours(typedMonday(weekHours(week(6.5)), "9"), week(7), false);
    expect(takeSavedHours(asking)).toEqual(weekHours(week(7)));
    const kept = keepTypedHours(asking);
    expect(kept).toEqual({ base: week(7), typed: asking.typed, newer: null });
    expect(saveInput(kept)).toEqual({ days: week(9), expectedDays: week(7) });
    // With nothing waiting, both choices leave the form as it is.
    const plain = weekHours(week(6.5));
    expect(takeSavedHours(plain)).toBe(plain);
    expect(keepTypedHours(plain)).toBe(plain);
  });

  it("(d) shows no notice after the person's own save, whichever comes first", () => {
    const typed = typedMonday(weekHours(week(6.5)), "8");
    const input = saveInput(typed);
    expect(input).toEqual({ days: week(8), expectedDays: week(6.5) });
    const savedFirst = serverHours(hoursSaved(typed, week(8)), week(8), false);
    const readFirst = hoursSaved(serverHours(typed, week(8), false), week(8));
    for (const form of [savedFirst, readFirst]) {
      expect(form).toEqual({ base: week(8), typed: typed.typed, newer: null });
    }
  });

  it("(e) shows the saved hours of a submitted or approved week, edits or not", () => {
    const edited = typedMonday(weekHours(week(6.5)), "9");
    expect(serverHours(edited, week(7), true)).toEqual(weekHours(week(7)));
  });

  it("(f) compares hours by value, so 7 and 7.0 are the same", () => {
    const form = typedMonday(weekHours(week(6.5)), "7.0");
    expect(serverHours(form, week(7), false)).toEqual({ base: week(7), typed: form.typed, newer: null });
  });

  it("(g) takes an upload into a week that had no sheet", () => {
    const empty = weekHours();
    expect(empty).toEqual(weekHours(week(0)));
    expect(serverHours(empty, week(7), false)).toEqual(weekHours(week(7)));
    expect(serverHours(weekHours(week(7)), undefined, false)).toEqual(weekHours(week(0)));
  });

  it("(h) leaves no notice when the person types while their save runs, whichever answer comes first", () => {
    const sending = typedMonday(weekHours(week(6.5)), "8");
    const typing = typedMonday(sending, "9");
    const readFirst = hoursSaved(serverHours(typing, week(8), false), week(8));
    const savedFirst = serverHours(hoursSaved(typing, week(8)), week(8), false);
    for (const form of [readFirst, savedFirst]) {
      expect(form).toEqual({ base: week(8), typed: typing.typed, newer: null });
      expect(saveInput(form)).toEqual({ days: week(9), expectedDays: week(8) });
    }
  });

  it("(i) clears the notice once the saved hours are back to those the form started from", () => {
    const asking = serverHours(typedMonday(weekHours(week(6.5)), "9"), week(7), false);
    expect(asking.newer).toEqual(week(7));
    const back = serverHours(asking, week(6.5), false);
    expect(back).toEqual({ base: week(6.5), typed: asking.typed, newer: null });
  });

  it("(j) reads typed text as the save does, never throwing on half-typed hours", () => {
    expect(["", ".", "7.", "7..5", "07"].map(parseHours)).toEqual([0, 0, 7, 0, 7]);
    expect(typedMonday(weekHours(), "7a.5 h").typed[0]).toBe("7.5");
    // A cleared field is no edit, so newer hours replace it.
    for (const text of ["", "."]) {
      const form = typedMonday(weekHours(week(0)), text);
      expect(typedHours(form)).toEqual(week(0));
      expect(serverHours(form, week(7), false)).toEqual(weekHours(week(7)));
    }
    // "7." and "07" are 7, so a save of 7 keeps the text under the cursor.
    for (const text of ["7.", "07"]) {
      const form = typedMonday(weekHours(week(6.5)), text);
      expect(serverHours(form, week(7), false)).toEqual({ base: week(7), typed: form.typed, newer: null });
    }
    // "7..5" reads as 0, as the save always has, and never throws.
    const odd = typedMonday(weekHours(week(6.5)), "7..5");
    expect(serverHours(odd, week(7), false).newer).toEqual(week(7));
  });
});
