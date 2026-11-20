import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOLIDAY_NAME_MAX,
  HOLIDAYS_MAX,
  hrFrequencyProblem,
  HR_MESSAGES,
  hrScheduleProblem,
  hrSettingsProblem,
  payFrequencyProblem,
  settingsSectionProblem,
  type HrSettings,
  type HrSettingsInput,
} from "../src";

const summit = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8")) as {
  settings: { hr: HrSettings };
};
const HR = summit.settings.hr;
/** Every demo company's seeded section, which DemoStore judges on its first save. */
const SEEDED = ["summit", "harbor", "keystone"].map(
  (name) =>
    (
      JSON.parse(
        readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8"),
      ) as typeof summit
    ).settings.hr,
);
const NOTHING = { payPeriods: false, hoursRecorded: false };
const CA_HOURLY = { state: "CA", flsaStatus: "non_exempt", status: "active" } as const;

/**
 * Settings → HR's shared rules (ADR 0059, part 5): the content rule both modes run with the same
 * words (D2), the schedule lock against recorded pay (D4) and the monthly rule on a change (D5).
 */
describe("Settings → HR rules (ADR 0059, part 5)", () => {
  it("HR1 every seeded section passes, and the dispatcher runs the same rule", () => {
    for (const seeded of SEEDED) expect(hrSettingsProblem(seeded)).toBeNull();
    expect(settingsSectionProblem("hr", HR, HR)).toBeNull();
    expect(settingsSectionProblem("hr", { ...HR, workweekStartDay: 7 }, HR)).toBe(HR_MESSAGES.workweekStartDay);
  });

  it("HR2 each field's refusal, with its words", () => {
    const holiday = (date: string, name = "Founders' Day") => ({ date, name });
    const cases: [Partial<HrSettingsInput>, string][] = [
      [{ workweekStartDay: -1 }, HR_MESSAGES.workweekStartDay],
      [{ workweekStartDay: 7 }, HR_MESSAGES.workweekStartDay],
      [{ workweekStartDay: 1.5 }, HR_MESSAGES.workweekStartDay],
      [{ workweekStartDay: "1" as unknown as number }, HR_MESSAGES.workweekStartDay],
      [{ payFrequency: "daily" }, HR_MESSAGES.payFrequency],
      [{ payFrequency: "Weekly" }, HR_MESSAGES.payFrequency],
      [{ payPeriodAnchor: "" }, HR_MESSAGES.payPeriodAnchor],
      [{ payPeriodAnchor: "2026-02-30" }, HR_MESSAGES.payPeriodAnchor],
      [{ payPeriodAnchor: "2026-1-5" }, HR_MESSAGES.payPeriodAnchor],
      [{ payPeriodAnchor: "2026-01-05T00:00:00Z" }, HR_MESSAGES.payPeriodAnchor],
      [{ payPeriodAnchor: "1999-12-27" }, HR_MESSAGES.payPeriodAnchor],
      [{ payPeriodAnchor: "2100-01-04" }, HR_MESSAGES.payPeriodAnchor],
      [{ holidays: [holiday("2026-13-01")] }, HR_MESSAGES.holidayDate],
      [{ holidays: [holiday("2026-07-04 ")] }, HR_MESSAGES.holidayDate],
      [{ holidays: [holiday("2026-07-04", "  ")] }, HR_MESSAGES.holidayName],
      [{ holidays: [holiday("2026-07-04", "x".repeat(HOLIDAY_NAME_MAX + 1))] }, HR_MESSAGES.holidayName],
      [{ holidays: [holiday("2026-07-04"), holiday("2026-07-04", "Picnic")] }, HR_MESSAGES.holidayTwice],
      [
        { holidays: Array.from({ length: HOLIDAYS_MAX + 1 }, (_, i) => holiday(`2030-01-01`, `Day ${i}`)) },
        HR_MESSAGES.holidays,
      ],
      [{ clockEnabled: "yes" as unknown as boolean }, HR_MESSAGES.switches],
      [{ showRatesToEmployees: null as unknown as boolean }, HR_MESSAGES.switches],
    ];
    for (const [patch, message] of cases)
      expect(hrSettingsProblem({ ...HR, ...patch }), JSON.stringify(patch)).toBe(message);
  });

  it("HR3 the edges that pass: every weekday, every frequency, a name at its limit, a full list, no holidays", () => {
    for (const day of [0, 6]) expect(hrSettingsProblem({ ...HR, workweekStartDay: day })).toBeNull();
    for (const payFrequency of ["weekly", "biweekly", "semimonthly", "monthly"])
      expect(hrSettingsProblem({ ...HR, payFrequency })).toBeNull();
    expect(hrSettingsProblem({ ...HR, payPeriodAnchor: "2028-02-29" })).toBeNull();
    expect(hrSettingsProblem({ ...HR, holidays: [] })).toBeNull();
    const padded = { date: "2026-07-04", name: ` ${"x".repeat(HOLIDAY_NAME_MAX)} ` };
    expect(hrSettingsProblem({ ...HR, holidays: [padded] })).toBeNull();
    const full = Array.from({ length: HOLIDAYS_MAX }, (_, i) => ({
      date: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10),
      name: `Day ${i}`,
    }));
    expect(hrSettingsProblem({ ...HR, holidays: full })).toBeNull();
  });

  it("HR4 the schedule lock: frequency and anchor fixed once a pay period exists; the workweek once hours or a period exist", () => {
    const periods = { payPeriods: true, hoursRecorded: false };
    const hours = { payPeriods: false, hoursRecorded: true };
    const weekly = { ...HR, payFrequency: "weekly" as const };
    const anchored = { ...HR, payPeriodAnchor: "2026-01-12" };
    const sunday = { ...HR, workweekStartDay: (HR.workweekStartDay + 6) % 7 };
    expect(hrScheduleProblem(weekly, HR, periods)).toBe(HR_MESSAGES.scheduleLocked);
    expect(hrScheduleProblem(anchored, HR, periods)).toBe(HR_MESSAGES.scheduleLocked);
    expect(hrScheduleProblem(weekly, HR, hours)).toBeNull();
    expect(hrScheduleProblem(anchored, HR, NOTHING)).toBeNull();
    expect(hrScheduleProblem(sunday, HR, hours)).toBe(HR_MESSAGES.workweekLocked);
    expect(hrScheduleProblem(sunday, HR, periods)).toBe(HR_MESSAGES.workweekLocked);
    expect(hrScheduleProblem(sunday, HR, NOTHING)).toBeNull();
    // Everything else saves whatever is recorded: holidays and the five switches.
    const everythingElse = {
      ...HR,
      holidays: [],
      showPayToEmployees: !HR.showPayToEmployees,
      showCommissionToEmployees: !HR.showCommissionToEmployees,
      showRatesToEmployees: !HR.showRatesToEmployees,
      showTeamCalendarToEmployees: !HR.showTeamCalendarToEmployees,
      clockEnabled: !HR.clockEnabled,
    };
    expect(hrScheduleProblem(everythingElse, HR, { payPeriods: true, hoursRecorded: true })).toBeNull();
  });

  it("HR5 never saved, or a stored row without the fields, counts every schedule field as changed", () => {
    expect(hrScheduleProblem(HR, undefined, NOTHING)).toBeNull();
    expect(hrScheduleProblem(HR, undefined, { payPeriods: false, hoursRecorded: true })).toBe(
      HR_MESSAGES.workweekLocked,
    );
    expect(
      hrScheduleProblem(HR, { workweekStartDay: HR.workweekStartDay }, { payPeriods: true, hoursRecorded: true }),
    ).toBe(HR_MESSAGES.scheduleLocked);
  });

  it("HR6 monthly with California non-exempt staff is refused on a change of frequency only, in payFrequencyProblem's words", () => {
    const monthly = { ...HR, payFrequency: "monthly" as const };
    const words = payFrequencyProblem("monthly", [CA_HOURLY]);
    expect(words).toBe("California non-exempt staff must be paid at least twice a month.");
    expect(hrFrequencyProblem(monthly, HR, [CA_HOURLY])).toBe(words);
    expect(hrFrequencyProblem(monthly, undefined, [CA_HOURLY])).toBe(words);
    // Already monthly: holidays and switches still save (approval still refuses the run).
    expect(hrFrequencyProblem({ ...monthly, holidays: [] }, monthly, [CA_HOURLY])).toBeNull();
    expect(hrFrequencyProblem(monthly, HR, [{ ...CA_HOURLY, status: "terminated" }])).toBeNull();
    expect(hrFrequencyProblem(monthly, HR, [{ ...CA_HOURLY, flsaStatus: "exempt" }])).toBeNull();
    expect(hrFrequencyProblem(monthly, HR, [{ ...CA_HOURLY, state: "CO" }])).toBeNull();
    expect(hrFrequencyProblem({ ...HR, payFrequency: "semimonthly" }, monthly, [CA_HOURLY])).toBeNull();
  });
});
