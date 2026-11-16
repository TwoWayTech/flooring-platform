import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type {
  AuditEntry,
  BusinessReport,
  InAppNotification,
  NotificationEventKey,
  OutboxAttachment,
  OutboxStatus,
  Payment,
  PayPeriod,
  PayPeriodLine,
  TimesheetWire,
} from "@workspace/shared";
import type { MyPortal, PayPeriodReview } from "@/lib/api/contract";
import { companyToday, PDF_PROOF, waitForAnswer } from "./kit";
import { ledgerDelta, ledgerMismatches, type ExpectedMoves, type TrialBalance } from "./ledger";

/** Reads an `/api-proxy` route as the request's person and returns its JSON, failing with the answer's text on anything but 200. */
export async function readAs<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api-proxy${path}`);
  expect(response.status(), `GET ${path} answered ${response.status()}: ${await response.text()}`).toBe(200);
  return (await response.json()) as T;
}

/**
 * Sends a POST to an `/api-proxy` route as the request's person and returns its JSON, failing with
 * the answer's text on anything but 201 (how the API answers a POST that worked). For a step no
 * screen offers and for sweeping an earlier run's leftovers, never for a step a screen does.
 */
export async function postAs<T>(request: APIRequestContext, path: string, data?: object): Promise<T> {
  const response = await request.post(`/api-proxy${path}`, data ? { data } : {});
  expect(response.status(), `POST ${path} answered ${response.status()}: ${await response.text()}`).toBe(201);
  return (await response.json()) as T;
}

/**
 * The trial balance as the person sees it (GET /ledger/trial-balance; needs `reports.financial.view`
 * at scope all, so Grace or the Owner). No screen shows it yet (STATUS "Later").
 */
export function trialBalance(request: APIRequestContext): Promise<TrialBalance> {
  return readAs<TrialBalance>(request, "/ledger/trial-balance");
}

/**
 * Asserts the books balance and moved from `before` to `after` exactly as `expected` says, with
 * every other account unchanged (plan-final.md section 1, "Ledger rule"). The message lists the
 * whole move, so a failure shows what did post.
 */
export function expectLedgerMoved(before: TrialBalance, after: TrialBalance, expected: ExpectedMoves): void {
  expect(after.balanced, `the books don't balance: debits ${after.debit}, credits ${after.credit}`).toBe(true);
  const moved = JSON.stringify(ledgerDelta(before, after));
  expect(ledgerMismatches(before, after, expected), `the books moved by ${moved}`).toEqual([]);
}

/** One Outbox row as GET /outbox answers it (apps/api `listOutbox`); the Outbox screen is still DemoStore in api mode. */
export interface OutboxRow {
  id: string;
  eventKey: NotificationEventKey;
  sourceType: string;
  sourceId: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  attachments: OutboxAttachment[];
  status: OutboxStatus;
  failureType: string | null;
  failureDetail: string | null;
}

/** The Outbox rows the person caused or received (all of them with `settings.outbox.view`), newest 200. */
export function outboxRows(request: APIRequestContext): Promise<OutboxRow[]> {
  return readAs<OutboxRow[]>(request, "/outbox");
}

/** One in-app note as GET /notifications answers it; the bell is still DemoStore in api mode. */
export type InAppNote = Pick<InAppNotification, "id" | "eventKey" | "title" | "href" | "readAt" | "createdAt">;

/** The person's own in-app notes, newest 50. */
export function notifications(request: APIRequestContext): Promise<InAppNote[]> {
  return readAs<InAppNote[]>(request, "/notifications");
}

/** Statuses of a row the worker has not finished with yet (it polls every 2 s). */
const IN_FLIGHT: ReadonlySet<OutboxStatus> = new Set(["queued", "sending"]);

/**
 * Waits up to 30 s for the person's Outbox rows that `match` to exist and leave `queued`, and
 * returns them. On CI (provider `memory`, docs/environment.md) each must be `sent`. Locally the
 * provider comes from the env file, which the tests never read, so a row that is not `sent` (a
 * real provider refusing a `.example` address) is noted on the test instead.
 */
export async function expectOutboxSent(
  request: APIRequestContext,
  match: (row: OutboxRow) => boolean,
): Promise<OutboxRow[]> {
  let rows: OutboxRow[] = [];
  await expect
    .poll(
      async () => {
        rows = (await outboxRows(request)).filter(match);
        return rows.length > 0 && rows.every((row) => !IN_FLIGHT.has(row.status));
      },
      { message: "the Outbox rows exist and the worker has sent them", timeout: 30_000 },
    )
    .toBe(true);
  for (const row of rows) {
    const what = `${row.eventKey} to ${row.recipientEmail} is ${row.status}${row.failureDetail ? ` (${row.failureDetail})` : ""}`;
    if (process.env.CI) expect(row.status, what).toBe("sent");
    else if (row.status !== "sent")
      test.info().annotations.push({ type: "outbox not sent locally", description: what });
  }
  return rows;
}

/**
 * Opens the Business report and moves Period to This month, as a person would, and returns the
 * answer the screen then shows (GET /reports/business for the first of this month to today).
 */
export async function openBusinessReport(page: Page): Promise<BusinessReport> {
  const today = companyToday();
  const first = waitForAnswer<BusinessReport>(page, "GET", /^\/api-proxy\/reports\/business$/);
  await page.goto("/reports");
  await first;
  const answer = waitForAnswer<BusinessReport>(page, "GET", /^\/api-proxy\/reports\/business$/, {
    from: `${today.slice(0, 8)}01`,
    to: today,
  });
  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option", { name: "This month", exact: true }).click();
  const report = await answer;
  await expect(page.getByRole("group", { name: "Business report figures" })).not.toHaveAttribute("aria-busy", "true");
  return report;
}

/**
 * Opens Pay periods on the period that holds `day` and returns its review, or null when no period
 * holds it. The page opens the `in_review` period first (pay-periods-page.tsx), so another period
 * is picked by its place in the `GET /pay-periods` answer, which is the picker's order; its labels
 * follow the company's date format, so they are not matched by text. The review must be that period's.
 */
export async function openPayPeriodReview(page: Page, day: string): Promise<PayPeriodReview | null> {
  const listed = waitForAnswer<PayPeriod[]>(page, "GET", /^\/api-proxy\/pay-periods$/);
  const shown = waitForAnswer<PayPeriodReview>(page, "GET", /^\/api-proxy\/pay-periods\/[^/]+\/review$/);
  await page.goto("/hr/pay-periods");
  const periods = await listed;
  const opened = await shown;
  const index = periods.findIndex((period) => period.start <= day && day <= period.end);
  const target = periods[index];
  if (!target) return null;
  if (opened.period.id === target.id) return opened;
  const answer = waitForAnswer<PayPeriodReview>(
    page,
    "GET",
    new RegExp(`^/api-proxy/pay-periods/${target.id}/review$`),
  );
  await page.getByRole("combobox", { name: "Pay period" }).click();
  await page.getByRole("option").nth(index).click();
  const review = await answer;
  expect(review.period.id, `the review shown is the period holding ${day}`).toBe(target.id);
  return review;
}

/**
 * The cell of `row` under the column headed `header` in `table`, found by the header's place in the
 * table's head rather than by a fixed index, so a column added to the screen doesn't move the check.
 */
export async function cellUnder(table: Locator, row: Locator, header: string): Promise<Locator> {
  await expect(row).toBeVisible();
  const headers = (await table.locator("thead th").allInnerTexts()).map((text) => text.trim());
  const index = headers.indexOf(header);
  expect(index, `a "${header}" column among: ${headers.join(" | ")}`).toBeGreaterThanOrEqual(0);
  return row.locator("th, td").nth(index);
}

/**
 * Opens Pay periods on the period holding `day` (`openPayPeriodReview`) and returns that period with
 * the pay line of the person named `name`. Review rows carry the employee's database id, not the
 * fixture's, so the name finds the row. Fails when no period holds the day: only a period up to
 * today can be opened.
 */
export async function openPayLine(
  page: Page,
  day: string,
  name: string,
): Promise<{ period: PayPeriod; line: PayPeriodLine }> {
  const review = await openPayPeriodReview(page, day);
  if (!review) throw new Error(`No pay period holds ${day}.`);
  const row = review.rows.find((r) => r.employee.name === name);
  if (!row) throw new Error(`The pay period ${review.period.start} to ${review.period.end} has no row for ${name}.`);
  return { period: review.period, line: row.line };
}

/** Asserts the open pay period's row for `name` shows, under each column header in `cells`, its text. */
export async function expectPayRow(page: Page, name: string, cells: Readonly<Record<string, string>>): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: name });
  const table = page.locator("table").filter({ has: row });
  for (const [header, text] of Object.entries(cells))
    await expect(await cellUnder(table, row, header)).toHaveText(text);
}

/** GET /me/portal as the API answers it: the screens' MyPortal with each week's hours as decimal strings (ADR 0046). */
export type PortalAnswer = Omit<MyPortal, "timesheets"> & { timesheets: TimesheetWire[] };

/**
 * Opens the employee portal page at `path` (My timesheet, My time off) and returns the GET /me/portal
 * answer it shows. Opening it again is a reload: in api mode a screen reads again only after a
 * meetings write (STATUS B2), so a flow loads the page afresh to see its own write.
 */
export async function openMyPortal(page: Page, path: string): Promise<PortalAnswer> {
  const answer = waitForAnswer<PortalAnswer>(page, "GET", /^\/api-proxy\/me\/portal$/);
  await page.goto(path);
  return answer;
}

/** The invoice's status pills in order: the leading status, then the labels beside it (ledger.ts `invoiceStatus`). */
export function invoicePills(page: Page): Locator {
  return page.getByRole("heading", { level: 1, name: /^Invoice / }).locator("xpath=following-sibling::span[1]/span");
}

/** How a recorded payment must come back: waiting for verification or counted at once, and why (the failure message). */
export interface PaymentOutcome {
  status: "pending" | "confirmed";
  why: string;
}

/**
 * Fills the open Record payment (or deposit) sheet on invoice `invoiceNumber` with the reference
 * and a proof, saves it and returns the API's answer. The answer's status must be `outcome`'s, and
 * the toast says the same (record-payment-sheet.tsx).
 */
export async function savePayment(
  page: Page,
  invoiceNumber: string,
  reference: string,
  outcome: PaymentOutcome,
): Promise<Payment> {
  const sheet = page.getByRole("dialog", { name: /^Record (payment|deposit)$/ });
  await sheet.getByLabel("Reference or transaction ID").fill(reference);
  await sheet.locator('input[type="file"]').setInputFiles(PDF_PROOF);
  const answer = waitForAnswer<Payment>(page, "POST", /^\/api-proxy\/payments$/);
  await sheet.getByRole("button", { name: /^Save (payment|deposit)$/ }).click();
  const payment = await answer;
  await expect(sheet).toBeHidden();
  expect(payment.reference).toBe(reference);
  expect(payment.status, outcome.why).toBe(outcome.status);
  const toast =
    outcome.status === "pending"
      ? `${payment.number} recorded; it waits for verification`
      : `${payment.number} recorded on ${invoiceNumber}`;
  await expect(page.getByText(toast, { exact: true })).toBeVisible();
  return payment;
}

/** The audit log shows `at` to the minute, in UTC ("2026-11-16T09:30"). */
function auditTime(at: string): number {
  return Date.parse(`${at}:00Z`);
}

/**
 * Asserts the audit log holds each of `actions` on a target containing `search`, made at or after
 * `since` (an epoch ms), first in the page's GET /audit answer, then on screen after searching
 * for `search`. Labels such as "Bri Alvarez, week of …" repeat across runs, hence the time bound:
 * `at` is kept to the minute, so `since` less 5 s is rounded down to its minute first.
 */
export async function expectAuditRows(
  page: Page,
  search: string,
  actions: readonly string[],
  since: number,
): Promise<void> {
  const answer = waitForAnswer<AuditEntry[]>(page, "GET", /^\/api-proxy\/audit$/);
  await page.goto("/settings/audit");
  const entries = await answer;
  const from = Math.floor((since - 5_000) / 60_000) * 60_000;
  for (const action of actions) {
    const found = entries.find((e) => e.action === action && e.target.includes(search) && auditTime(e.at) >= from);
    expect(found, `an audit entry "${action}" on "${search}" from ${new Date(from).toISOString()} on`).toBeDefined();
  }
  await page.getByPlaceholder("Search the audit log").fill(search);
  for (const action of actions)
    await expect(page.getByRole("row").filter({ hasText: action }).filter({ hasText: search }).first()).toBeVisible();
}
