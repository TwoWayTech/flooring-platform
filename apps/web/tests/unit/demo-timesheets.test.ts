import { describe, expect, it } from "vitest";
import { addDays, TIMESHEET_CHANGED_MESSAGE, TIMESHEET_TEMPLATE_HEADERS, workweekStartOf } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Summit's Bri Alvarez (fixtures): an hourly W-2 employee who fills in her own week. */
const BRI = { userId: "sm-usr-14", employeeId: "sm-emp-0014", email: "bri.alvarez@summitfloor.example" };

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with Summit open for Bri (each test starts from the fixtures). */
async function asBri(): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: BRI.userId, viewAsRoleId: null });
  return store;
}

/** The refusal an action gives, or "" when it was allowed. */
async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return "";
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

/** Two past weeks of Bri's with no sheet yet, so each test starts from weeks no fixture holds. */
async function freeWeeks(store: DemoStore): Promise<[string, string]> {
  const settings = await store.getSettings();
  const current = workweekStartOf(store.today(), settings.hr.workweekStartDay);
  const taken = new Set(
    (await store.list("timesheets")).filter((s) => s.employeeId === BRI.employeeId).map((s) => s.weekStart),
  );
  const [first, second] = Array.from({ length: 12 }, (_, n) => addDays(current, -7 * (n + 1))).filter(
    (w) => !taken.has(w),
  );
  if (!first || !second) throw new Error("Bri has a sheet in almost every recent week of the fixtures.");
  return [first, second];
}

/** Bri's own upload of Monday's hours for a week, saved as the dialog's second step does. */
function uploadMonday(store: DemoStore, week: string, hours: string) {
  return store.uploadTimesheets({
    table: { headers: [...TIMESHEET_TEMPLATE_HEADERS], rows: [[BRI.email, "", "Bri Alvarez", week, hours, ""]] },
    fileName: "my-hours.csv",
    apply: true,
    own: true,
  });
}

const week = (monday: number) => [monday, 0, 0, 0, 0, 0, 0];

/** Bri's stored hours for a week. */
async function storedDays(store: DemoStore, weekStart: string): Promise<number[] | undefined> {
  const sheets = await store.list("timesheets");
  return sheets.find((s) => s.employeeId === BRI.employeeId && s.weekStart === weekStart)?.days;
}

describe("the demo never saves a week's old hours over newer ones (hr.md Create or edit hours; ADR 0051, 2026-11-16)", () => {
  it("refuses a save from hours an upload has changed since, and keeps the upload's hours", async () => {
    const store = await asBri();
    const [w] = await freeWeeks(store);
    await store.saveTimesheet({ employeeId: BRI.employeeId, weekStart: w, days: week(8), expectedDays: week(0) });
    const uploaded = await uploadMonday(store, w, "6");
    expect(uploaded.rows.flatMap((r) => r.problems)).toEqual([]);
    expect(await storedDays(store, w)).toEqual(week(6));

    const stale = store.saveTimesheet({
      employeeId: BRI.employeeId,
      weekStart: w,
      days: week(9),
      expectedDays: week(8),
    });
    expect(await refusal(stale)).toBe(TIMESHEET_CHANGED_MESSAGE);
    expect(await storedDays(store, w)).toEqual(week(6));
  });

  it("takes a save from the upload's hours, and a save of the stored hours whatever the form started from", async () => {
    const store = await asBri();
    const [w, other] = await freeWeeks(store);
    await uploadMonday(store, w, "6");
    const sent = { employeeId: BRI.employeeId, weekStart: w };
    expect(await refusal(store.saveTimesheet({ ...sent, days: week(6), expectedDays: week(3) }))).toBe("");
    expect(await refusal(store.saveTimesheet({ ...sent, days: week(9), expectedDays: week(6) }))).toBe("");
    expect(await storedDays(store, w)).toEqual(week(9));
    // A form opened before the upload created the week started from zeros.
    await uploadMonday(store, other, "7");
    expect(await storedDays(store, other)).toEqual(week(7));
    const fromZeros = store.saveTimesheet({ ...sent, weekStart: other, days: week(8), expectedDays: week(0) });
    expect(await refusal(fromZeros)).toBe(TIMESHEET_CHANGED_MESSAGE);
  });
});
