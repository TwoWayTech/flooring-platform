import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { addDays, dec, type PtoRequest, type ViewedPayLine } from "@workspace/shared";
import { FLOW_TAG } from "../../e2e/helpers";
import { EMPLOYEE_EMAIL, HR_EMAIL } from "../accounts";
import {
  expectAuditRows,
  expectPayRow,
  openMyPortal,
  openPayLine,
  payAtBaseRate,
  postAs,
  readAs,
  type PortalAnswer,
} from "./checks";
import {
  assertSameCompanyDay,
  choose,
  companyToday,
  EMPLOYEE_NAME,
  flowTest,
  formatted,
  resetAuthAround,
  runId,
  shown,
  waitForAnswer,
} from "./kit";

/** The seeded paid policy the run takes a day of; Bri has about 45 hours of it. */
const VACATION = "Vacation";

/** How a day off is asked for: 8 hours, the request dialog's default for one day. */
const DAY_HOURS = "8";

/** The note that marks a request as a flow's, so the sweep cancels only flows' leftovers. */
const NOTE_PREFIX = "e2e-flow-";

/** Whether a YYYY-MM-DD day is Monday to Friday. */
function isWeekday(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/**
 * The day off: the first weekday after today in the current pay period, so the approved request
 * can still be cancelled (time off that has started can't be); else today, if a weekday; else the
 * next weekday, which lies in a pay period that can't be opened yet.
 */
function dayOff(today: string, periodEnd: string): string {
  for (let day = addDays(today, 1); day <= periodEnd; day = addDays(day, 1)) if (isWeekday(day)) return day;
  if (isWeekday(today)) return today;
  let day = addDays(today, 1);
  while (!isWeekday(day)) day = addDays(day, 1);
  return day;
}

/** Bri's Vacation balance in a portal answer: its hours, and the hours waiting for a decision. */
function vacationOf(portal: PortalAnswer): PortalAnswer["balances"][number] {
  const balance = portal.balances.find((b) => b.policy.name === VACATION);
  if (!balance) throw new Error(`Bri has no ${VACATION} balance.`);
  return balance;
}

/** Asserts My time off shows the Vacation balance as `balance` holds it, with the waiting hours only when there are any. */
async function expectVacationShown(page: Page, balance: PortalAnswer["balances"][number]): Promise<void> {
  const values = page
    .getByRole("region", { name: "Balances" })
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${VACATION}$`) }) })
    .locator("dd");
  await expect(values.first()).toHaveText(`${shown(balance.hours, "quantity")} hours`);
  if (dec(balance.pending).gt(0))
    await expect(values.nth(1)).toHaveText(`${shown(balance.pending, "quantity")} hours waiting for a decision`);
  else await expect(values).toHaveCount(1);
}

/** The pay figures time off moves, to compare a review before and after. */
function leaveFigures(line: ViewedPayLine): Pick<ViewedPayLine, "paidLeaveHours" | "paidLeavePay" | "grossPay"> {
  return { paidLeaveHours: line.paidLeaveHours, paidLeavePay: line.paidLeavePay, grossPay: line.grossPay };
}

/** As Bri, through the product's route: cancels an earlier run's pending or approved request that hasn't started. */
async function sweep(request: APIRequestContext, today: string): Promise<void> {
  const { requests } = await readAs<PortalAnswer>(request, "/me/portal");
  const left = requests.filter(
    (r) => r.note.startsWith(NOTE_PREFIX) && (r.status === "pending" || r.status === "approved") && r.start >= today,
  );
  for (const r of left) await postAs(request, `/pto-requests/${r.id}/cancel`);
}

/**
 * Flow F4 (mirrors demo flow G3-4; session log 2026-11-16-0200, "The seven flows"): Bri asks for a
 * day of Vacation, Tamara approves it, the pay period pays the day and Bri's balance drops by it;
 * Bri then cancels it, which only the API offers (hr.md "To cancelled"), and the balance and the pay
 * are back. Every figure comes from the answers the screens got. A cancelled request and its two
 * balance entries (append-only) stay.
 */
flowTest.describe("flow F4: time off to balance and pay, and back", () => {
  resetAuthAround([HR_EMAIL, EMPLOYEE_EMAIL]);

  flowTest(
    "approved time off takes the balance and pays the day, and cancelling it puts both back",
    { tag: FLOW_TAG },
    async ({ personas }) => {
      flowTest.setTimeout(120_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const note = `${NOTE_PREFIX}${run}`;
      const tamara = await personas.open(HR_EMAIL, { mfa: true });
      const bri = await personas.open(EMPLOYEE_EMAIL);

      await flowTest.step("0. sweep: cancel an earlier run's open requests", () => sweep(bri.request, start));

      const { day, before } = await flowTest.step("1. Tamara reads the pay period before", async () => {
        const current = await openPayLine(tamara.page, start, EMPLOYEE_NAME);
        const chosen = dayOff(start, current.period.end);
        if (chosen <= current.period.end) return { day: chosen, before: current.line };
        flowTest.info().annotations.push({
          type: "pay not checked",
          description: `${chosen} lies in a pay period that can't be opened yet, so steps 4 and 6 skip the pay`,
        });
        return { day: chosen, before: null };
      });

      const { asked, was } = await flowTest.step("2. Bri asks for the day off", async () => {
        const { page } = bri;
        const balance = vacationOf(await openMyPortal(page, "/my/time-off"));
        await expectVacationShown(page, balance);
        await page.getByRole("button", { name: "Request time off" }).click();
        const dialog = page.getByRole("dialog", { name: "Request time off" });
        await dialog.getByLabel("First day", { exact: true }).fill(day);
        await dialog.getByLabel("Last day", { exact: true }).fill(day);
        await choose(page, dialog.getByLabel("Type", { exact: true }), VACATION);
        await expect(dialog.getByLabel("Hours", { exact: true })).toHaveValue(DAY_HOURS);
        await dialog.getByLabel("Note", { exact: true }).fill(note);
        const answer = waitForAnswer<PtoRequest>(page, "POST", /^\/api-proxy\/pto-requests$/);
        // The request makes the page read again (ADR 0051, 2026-11-16): the read My time off then shows.
        const reread = waitForAnswer<PortalAnswer>(page, "GET", /^\/api-proxy\/me\/portal$/);
        await dialog.getByRole("button", { name: "Send request" }).click();
        const request = await answer;
        personas.onCleanup(`cancel ${note}`, () => bri.request.post(`/api-proxy/pto-requests/${request.id}/cancel`));
        await expect(page.getByText("Time-off request sent", { exact: true })).toBeVisible();
        await expect(dialog).toBeHidden();
        expect(request).toMatchObject({ status: "pending", start: day, end: day, kind: "vacation", note });
        expect(dec(request.hours).eq(DAY_HOURS), `${DAY_HOURS} hours asked for, not ${request.hours}`).toBe(true);

        // On the same page, read again: the balance is as it was, with the day waiting for a decision.
        const waiting = vacationOf(await reread);
        expect(waiting.hours).toBe(balance.hours);
        expect(dec(waiting.pending).eq(dec(balance.pending).plus(DAY_HOURS)), `waiting: ${waiting.pending}`).toBe(true);
        await expectVacationShown(page, waiting);
        return { asked: request, was: balance };
      });

      await flowTest.step("3. Tamara approves it", async () => {
        const { page } = tamara;
        await page.goto("/hr/time-off");
        await page.getByPlaceholder("Search requests").fill(EMPLOYEE_NAME);
        const answer = waitForAnswer<PtoRequest>(
          page,
          "POST",
          new RegExp(`^/api-proxy/pto-requests/${asked.id}/decision$`),
        );
        await page.getByRole("row").filter({ hasText: note }).getByRole("button", { name: "Approve" }).click();
        expect((await answer).status).toBe("approved");
        await expect(page.getByText(`Time off approved for ${EMPLOYEE_NAME}`, { exact: true })).toBeVisible();
        // The same queue, read again after the approval, no longer offers to approve it.
        await expect(
          page.getByRole("row").filter({ hasText: note }).getByRole("button", { name: "Approve" }),
        ).toHaveCount(0);
      });

      await flowTest.step("4. the pay period pays the day", async () => {
        if (!before) return;
        const after = (await openPayLine(tamara.page, day, EMPLOYEE_NAME)).line;
        const leavePay = dec(after.paidLeavePay).minus(before.paidLeavePay);
        const grossPay = dec(after.grossPay).minus(before.grossPay);
        // Each line pays its leave hours at its base rate, rounded once (hr.md "Business rules" 17,
        // "Pay lines"); with no other leave in the period that is the day's DAY_HOURS × rate.
        const owed = payAtBaseRate(after, "paidLeaveHours").minus(payAtBaseRate(before, "paidLeaveHours"));
        expect(
          dec(after.paidLeaveHours).minus(before.paidLeaveHours).eq(DAY_HOURS),
          `paid leave hours rose by ${DAY_HOURS}: ${before.paidLeaveHours} to ${after.paidLeaveHours}`,
        ).toBe(true);
        expect(owed.gt(0), `the day is paid: ${after.paidLeaveHours} hours at ${after.baseRate}`).toBe(true);
        expect(
          leavePay.eq(owed),
          `paid leave pay rose by ${owed} (leave hours at ${after.baseRate}, rounded per line): ` +
            `${before.paidLeavePay} to ${after.paidLeavePay}`,
        ).toBe(true);
        expect(grossPay.eq(leavePay), `gross pay rose by the leave pay's ${leavePay}, not ${grossPay}`).toBe(true);
        await expectPayRow(tamara.page, EMPLOYEE_NAME, { "Paid leave": shown(after.paidLeavePay, "money") });
      });

      await flowTest.step("5. Bri's balance: the day is taken", async () => {
        const taken = vacationOf(await openMyPortal(bri.page, "/my/time-off"));
        expect(
          dec(taken.hours).eq(dec(was.hours).minus(DAY_HOURS)),
          `${VACATION}: ${was.hours} less ${DAY_HOURS} is ${taken.hours}`,
        ).toBe(true);
        expect(dec(taken.pending).eq(was.pending), `nothing of this run waits: ${taken.pending}`).toBe(true);
        await expectVacationShown(bri.page, taken);
      });

      await flowTest.step("6. Bri cancels it through the API: the balance and the pay are back", async () => {
        // No screen cancels approved time off (hr.md "To cancelled"; session log 2026-11-16-0200,
        // "What changed from the first plan" row 8).
        const cancelled = await postAs<PtoRequest>(bri.request, `/pto-requests/${asked.id}/cancel`);
        expect(cancelled.status).toBe("cancelled");
        const portal = await openMyPortal(bri.page, "/my/time-off");
        const back = vacationOf(portal);
        expect(dec(back.hours).eq(was.hours), `${VACATION} is back to ${was.hours}, not ${back.hours}`).toBe(true);
        await expectVacationShown(bri.page, back);
        // The list shows the requests in the answer's order; the note isn't on screen, so the place finds it.
        const at = portal.requests.findIndex((r) => r.id === asked.id);
        expect(at, "the cancelled request is listed").toBeGreaterThanOrEqual(0);
        const item = bri.page.getByRole("region", { name: "My requests" }).getByRole("listitem").nth(at);
        await expect(item).toContainText(`${VACATION}, ${formatted(day)}`);
        await expect(item).toContainText("Cancelled");
        if (before) {
          const line = (await openPayLine(tamara.page, day, EMPLOYEE_NAME)).line;
          expect(leaveFigures(line), "the pay period is back to before").toEqual(leaveFigures(before));
        }
      });

      await flowTest.step("7. the audit log", () =>
        expectAuditRows(
          tamara.page,
          `${EMPLOYEE_NAME}, ${day}`,
          ["Requested time off", "Approved time off", "Cancelled time off"],
          since,
        ),
      );
      assertSameCompanyDay(start);
    },
  );
});
