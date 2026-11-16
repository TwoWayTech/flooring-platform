import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import {
  addDays,
  daysBetween,
  dec,
  sum,
  TIMESHEET_TEMPLATE_HEADERS,
  weekdayHeadings,
  type Employee,
  type TimesheetWire,
} from "@workspace/shared";
import type { TimesheetUploadResult } from "@/lib/api/contract";
import { FLOW_TAG } from "../../e2e/helpers";
import { EMPLOYEE_EMAIL, HR_EMAIL } from "../accounts";
import { expectAuditRows, expectPayRow, openMyPortal, openPayLine, payAtBaseRate, postAs, readAs } from "./checks";
import {
  assertSameCompanyDay,
  choose,
  companyToday,
  EMPLOYEE_NAME,
  flowTest,
  formatted,
  mondayOf,
  resetAuthAround,
  runId,
  shown,
  waitForAnswer,
} from "./kit";

/**
 * The hours a run puts on each day it fills: the first that differs from every value those days
 * already hold. An upload skips a day that already has its hours ("Already these hours"), so a
 * second run in the same week would otherwise save nothing. At most 37.5 a week: no overtime.
 */
const HOURS = ["6.5", "7", "7.5"] as const;

const UPLOAD = /^\/api-proxy\/timesheets\/upload$/;

/** The days a run fills in: Monday of `week` through today, or through Friday from Saturday on. */
function daysToFill(week: string, today: string): string[] {
  const last = Math.min(daysBetween(week, today), 4);
  return Array.from({ length: last + 1 }, (_, i) => addDays(week, i));
}

/** The template file (`TIMESHEET_TEMPLATE_HEADERS`): one row per day, Bri's email, the run in the note. */
function timesheetCsv(days: readonly string[], hours: string, run: string): string {
  const rows = days.map((day) => [EMPLOYEE_EMAIL, "", EMPLOYEE_NAME, day, hours, `e2e flow ${run}`]);
  return [TIMESHEET_TEMPLATE_HEADERS, ...rows].map((row) => row.join(",")).join("\n");
}

/** What the sweep leaves the run: its hours, and Bri's other weeks waiting for approval. */
interface Swept {
  hours: string;
  othersWaiting: string[];
}

/**
 * As Tamara, through the product's routes: sends Bri's `week` back if an earlier run left it
 * submitted, or reopens it if approved, so Bri can upload again. Picks this run's hours against
 * the first `filled` days, and lists Bri's other submitted weeks (the seeded 2026-10-26 one), which
 * approving this week must leave waiting.
 */
async function sweep(request: APIRequestContext, week: string, filled: number): Promise<Swept> {
  const bri = (await readAs<Employee[]>(request, "/employees")).find((e) => e.email.toLowerCase() === EMPLOYEE_EMAIL);
  if (!bri) throw new Error(`No employee has the email ${EMPLOYEE_EMAIL}.`);
  const sheets = (await readAs<TimesheetWire[]>(request, "/timesheets")).filter((s) => s.employeeId === bri.id);
  const sheet = sheets.find((s) => s.weekStart === week);
  if (sheet?.status === "submitted")
    await postAs(request, "/timesheets/decisions", { action: "reject", ids: [sheet.id], reason: "e2e flow sweep" });
  if (sheet?.status === "approved")
    await postAs(request, `/timesheets/${sheet.id}/reopen`, { reason: "e2e flow sweep" });
  const held = (sheet?.days ?? []).slice(0, filled);
  const hours = HOURS.find((h) => held.every((value) => !dec(value).eq(h)));
  // Only a hand edit leaves every candidate on the days to fill; the upload would then save nothing.
  if (!hours)
    throw new Error(
      `Bri's week of ${week} already holds each of ${HOURS.join(", ")} hours on the days to fill ` +
        `(${held.join(", ")}), so an upload would save nothing. Sign in as Bri, put other hours (such as 8) ` +
        `on one of those days in My timesheet, save, and run the flow again.`,
    );
  const othersWaiting = sheets.filter((s) => s.status === "submitted" && s.weekStart !== week).map((s) => s.weekStart);
  return { hours, othersWaiting };
}

/** Opens the approval queue searched for Bri, and returns how to find her row for a week ("Week of"). */
async function openQueue(page: Page): Promise<(week: string) => Locator> {
  await page.goto("/hr/timesheets?view=queue");
  await page.getByPlaceholder("Search timesheets").fill(EMPLOYEE_NAME);
  return (week) =>
    page
      .getByRole("row")
      .filter({ hasText: EMPLOYEE_NAME })
      .filter({ hasText: formatted(week) });
}

/** Opens the weekly grid on `week`, chosen by its label in the company's date format. */
async function openGridWeek(page: Page, week: string): Promise<void> {
  await page.goto("/hr/timesheets");
  await choose(
    page,
    page.getByRole("combobox", { name: "Week" }),
    `${formatted(week)} to ${formatted(addDays(week, 6))}`,
  );
}

/**
 * Flow F3 (mirrors demo flow G3-3; session log 2026-11-16-0200, "The seven flows"): Bri uploads this
 * week's hours from the template and submits the week, Tamara approves it from the queue, and the
 * pay period that holds it counts the hours and pays them; Tamara then reopens the week. Every
 * figure comes from the answers the screens got. The week stays a draft with this run's hours, and
 * the next run's sweep picks other hours.
 */
flowTest.describe("flow F3: timesheet upload to the pay period", () => {
  resetAuthAround([HR_EMAIL, EMPLOYEE_EMAIL]);

  flowTest(
    "an uploaded week, once approved, reaches the pay period's hours and gross pay, and reopens",
    { tag: FLOW_TAG },
    async ({ personas }) => {
      flowTest.setTimeout(120_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const week = mondayOf(start);
      const days = daysToFill(week, start);
      const fileName = `e2e-flow-${run}.csv`;
      const tamara = await personas.open(HR_EMAIL, { mfa: true });
      const bri = await personas.open(EMPLOYEE_EMAIL);

      const { hours, othersWaiting } = await flowTest.step(
        "0. sweep: Bri's week back to a draft, this run's hours",
        () => sweep(tamara.request, week, days.length),
      );

      const before = await flowTest.step("1. Tamara reads the pay period before", async () => {
        return (await openPayLine(tamara.page, start, EMPLOYEE_NAME)).line;
      });

      const sheet = await flowTest.step("2. Bri uploads the template and submits the week", async () => {
        const { page } = bri;
        const portal = await openMyPortal(page, "/my/timesheet");
        expect(portal.weekStart, "Summit's workweek starts on Monday").toBe(week);
        await page.getByRole("button", { name: "Upload", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Upload hours" });
        const dryRun = waitForAnswer<TimesheetUploadResult>(page, "POST", UPLOAD);
        await dialog.getByLabel("Timesheet file").setInputFiles({
          name: fileName,
          mimeType: "text/csv",
          buffer: Buffer.from(timesheetCsv(days, hours, run)),
        });
        await dryRun;
        await expect(dialog.getByRole("status")).toHaveText(
          `${days.length} days to save, 0 left as they were, 0 with errors.`,
        );
        const saved = waitForAnswer<TimesheetUploadResult>(page, "POST", UPLOAD);
        await dialog.getByRole("button", { name: "Save hours" }).click();
        await saved;
        await expect(page.getByText(`${days.length} days of hours saved`, { exact: true })).toBeVisible();
        await expect(dialog).toBeHidden();

        // Submit saves what the form holds first, so the form must hold the upload (session log
        // 2026-11-16-0200, "What changed from the first plan" row 11).
        const reloaded = await openMyPortal(page, "/my/timesheet");
        for (const heading of weekdayHeadings(reloaded.weekStartDay).slice(0, days.length))
          await expect(page.getByLabel(heading, { exact: true }), `${heading} holds the upload`).toHaveValue(hours);
        const answer = waitForAnswer<TimesheetWire>(page, "POST", /^\/api-proxy\/timesheets\/[^/]+\/submit$/);
        await page.getByRole("button", { name: "Submit", exact: true }).click();
        const submitted = await answer;
        personas.onCleanup(`send back Bri's week of ${week}`, () =>
          tamara.request.post("/api-proxy/timesheets/decisions", {
            data: { action: "reject", ids: [submitted.id], reason: "e2e flow clean-up" },
          }),
        );
        await expect(page.getByText("Timesheet submitted", { exact: true })).toBeVisible();
        expect(submitted.status).toBe("submitted");
        expect(submitted.weekStart).toBe(week);
        expect(
          submitted.days.slice(0, days.length).every((value) => dec(value).eq(hours)),
          `${hours} hours on each of ${days.join(", ")}: ${submitted.days.join(", ")}`,
        ).toBe(true);
        return submitted;
      });

      await flowTest.step("3. Tamara approves the week from the queue", async () => {
        const { page } = tamara;
        const rowFor = await openQueue(page);
        for (const other of othersWaiting) await expect(rowFor(other), `Bri's week of ${other} waits`).toBeVisible();
        const decided = waitForAnswer<{ ok: true }>(page, "POST", /^\/api-proxy\/timesheets\/decisions$/);
        await rowFor(week).getByRole("button", { name: "Approve", exact: true }).click();
        await decided;
        personas.onCleanup(`reopen Bri's week of ${week}`, () =>
          tamara.request.post(`/api-proxy/timesheets/${sheet.id}/reopen`, { data: { reason: "e2e flow clean-up" } }),
        );
        await expect(page.getByText(`Timesheet approved for ${EMPLOYEE_NAME}`, { exact: true })).toBeVisible();

        // Loaded again (B2): this week has left the queue, and Bri's other weeks still wait.
        const again = await openQueue(page);
        for (const other of othersWaiting)
          await expect(again(other), `Bri's week of ${other} still waits`).toBeVisible();
        await expect(again(week)).toHaveCount(0);
      });

      await flowTest.step("4. Tamara checks the pay period: the hours and the gross pay", async () => {
        const after = (await openPayLine(tamara.page, start, EMPLOYEE_NAME)).line;
        const worked = sum(sheet.days);
        const hoursPay = dec(after.straightTimePay).minus(before.straightTimePay);
        const grossPay = dec(after.grossPay).minus(before.grossPay);
        // Each line pays its hours at its base rate, rounded once (hr.md "Business rules" 17, "Pay lines").
        const owed = payAtBaseRate(after, "hoursWorked").minus(payAtBaseRate(before, "hoursWorked"));
        expect(
          dec(after.hoursWorked).minus(before.hoursWorked).eq(worked),
          `hours worked rose by the week's ${worked}: ${before.hoursWorked} to ${after.hoursWorked}`,
        ).toBe(true);
        expect(
          dec(after.overtimeHours).eq(before.overtimeHours),
          `no overtime (at most 37.5 hours a week): ${before.overtimeHours} to ${after.overtimeHours}`,
        ).toBe(true);
        expect(owed.gt(0), `the hours are paid: ${after.hoursWorked} hours at ${after.baseRate}`).toBe(true);
        expect(
          hoursPay.eq(owed),
          `straight-time pay rose by ${owed} (hours at ${after.baseRate}, rounded per line): ` +
            `${before.straightTimePay} to ${after.straightTimePay}`,
        ).toBe(true);
        expect(grossPay.eq(hoursPay), `gross pay rose by the hours pay's ${hoursPay}, not ${grossPay}`).toBe(true);
        await expectPayRow(tamara.page, EMPLOYEE_NAME, {
          Hours: shown(after.hoursWorked, "quantity"),
          "Gross pay": shown(after.grossPay, "money"),
        });
      });

      await flowTest.step("5. Tamara reopens the week: a draft again with the run's hours", async () => {
        const { page } = tamara;
        await openGridWeek(page, week);
        const reopen = `Reopen ${EMPLOYEE_NAME}'s timesheet`;
        await page.getByRole("button", { name: reopen }).click();
        const dialog = page.getByRole("dialog", { name: reopen });
        await dialog.getByLabel("Reason").fill("e2e flow clean-up");
        const answer = waitForAnswer<TimesheetWire>(
          page,
          "POST",
          new RegExp(`^/api-proxy/timesheets/${sheet.id}/reopen$`),
        );
        await dialog.getByRole("button", { name: "Reopen", exact: true }).click();
        const reopened = await answer;
        await expect(dialog).toBeHidden();
        expect(reopened.status).toBe("draft");
        expect(reopened.days).toEqual(sheet.days);
        await openGridWeek(page, week);
        await expect(page.getByRole("row").filter({ hasText: EMPLOYEE_NAME })).toContainText("Draft");
      });

      await flowTest.step("6. the audit log", async () => {
        await expectAuditRows(tamara.page, fileName, ["Uploaded timesheet hours"], since);
        await expectAuditRows(
          tamara.page,
          `${EMPLOYEE_NAME}, week of ${week}`,
          ["Saved timesheet hours", "Submitted timesheet", "Approved timesheet", "Reopened timesheet"],
          since,
        );
      });
      assertSameCompanyDay(start);
    },
  );
});
