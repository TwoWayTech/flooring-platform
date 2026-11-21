import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page } from "@playwright/test";
import {
  dec,
  roundMoney,
  type AuditEntry,
  type BusinessReport,
  type Dec,
  type InAppNotification,
  type NotificationEventKey,
  type OutboxAttachment,
  type OutboxStatus,
  type Payment,
  type PayPeriod,
  type ViewedPayLine,
  type TimesheetWire,
} from "@workspace/shared";
import type { MyPortal, PayPeriodReview } from "@/lib/api/contract";
import { nextCode } from "../accounts";
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
 * at scope all and the cost and pay sight its figures reveal, so Grace or the Owner; ADR 0055).
 */
export function trialBalance(request: APIRequestContext): Promise<TrialBalance> {
  return readAs<TrialBalance>(request, "/ledger/trial-balance");
}

/**
 * Asserts the books balance and moved from `before` to `after` exactly as `expected` says, with
 * every other account unchanged (the flows' ledger rule, session log 2026-11-16-0200, decision 4).
 * The message lists the whole move, so a failure shows what did post.
 */
export function expectLedgerMoved(before: TrialBalance, after: TrialBalance, expected: ExpectedMoves): void {
  expect(after.balanced, `the books don't balance: debits ${after.debit}, credits ${after.credit}`).toBe(true);
  const moved = JSON.stringify(ledgerDelta(before, after));
  expect(ledgerMismatches(before, after, expected), `the books moved by ${moved}`).toEqual([]);
}

/** One Outbox row as GET /outbox answers it (apps/api `listOutbox`), which the Outbox screens read in api mode too. */
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

/** The Outbox rows the person caused or received, newest 200 (`?all=true` would give the whole company's to `settings.outbox.view`). */
export function outboxRows(request: APIRequestContext): Promise<OutboxRow[]> {
  return readAs<OutboxRow[]>(request, "/outbox");
}

/** One in-app note as GET /notifications answers it, which the bell reads in api mode too. */
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

/** Any pay period's review read, `GET /pay-periods/:id/review`. */
const ANY_REVIEW = /^\/api-proxy\/pay-periods\/[^/]+\/review$/;

/**
 * Opens Pay periods on the period that holds `day` and returns its review, or null when no period
 * holds it. The page opens the `in_review` period first (pay-periods-page.tsx), so another period
 * is picked by its place in the `GET /pay-periods` answer, which is the picker's order; its labels
 * follow the company's date format, so they are not matched by text. The review must be that period's.
 */
export async function openPayPeriodReview(page: Page, day: string): Promise<PayPeriodReview | null> {
  const listed = waitForAnswer<PayPeriod[]>(page, "GET", /^\/api-proxy\/pay-periods$/);
  const shown = waitForAnswer<PayPeriodReview>(page, "GET", ANY_REVIEW);
  await page.goto("/hr/pay-periods");
  const periods = await listed;
  const opened = await shown;
  const index = periods.findIndex((period) => period.start <= day && day <= period.end);
  const target = periods[index];
  if (!target) return null;
  if (opened.period.id === target.id) return opened;
  // Any period's review: the id check below then fails if the picker opened another period.
  const answer = waitForAnswer<PayPeriodReview>(page, "GET", ANY_REVIEW);
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
): Promise<{ period: PayPeriod; line: ViewedPayLine }> {
  const review = await openPayPeriodReview(page, day);
  if (!review) throw new Error(`No pay period holds ${day}.`);
  const row = review.rows.find((r) => r.employee.name === name);
  if (!row) throw new Error(`The pay period ${review.period.start} to ${review.period.end} has no row for ${name}.`);
  return { period: review.period, line: row.line };
}

/**
 * What an hourly pay line pays for its `hours` (hours worked, or paid leave): the hours times the
 * line's base rate, rounded to the cent once per pay line, as hr.md "Business rules" 17 ("Gross pay
 * per person and period", "Pay lines") has `grossPay` (packages/shared/src/hr/pay.ts) do it with
 * `roundMoney`. An hourly rate is stored to the cent (`payRate` numeric(14,2)), so the line's
 * two-place `baseRate` is the rate the pay used; its hours are two-place too, which the flows' whole
 * and half hours fill exactly. The API strips `baseRate` without
 * `hr.employee.view_sensitive` (CLAUDE.md rule 5), so only a reader who holds it (Tamara) can check
 * the pay this way.
 */
export function payAtBaseRate(line: ViewedPayLine, hours: "hoursWorked" | "paidLeaveHours"): Dec {
  const rate = line.baseRate;
  if (rate === undefined)
    throw new Error("The pay line carries no base rate: read it as someone with hr.employee.view_sensitive.");
  return roundMoney(dec(line[hours]).times(rate));
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
 * answer it shows. Opening it again is a reload, for a write made by another persona or through the
 * API (no live updates); a screen reads again after its own writes (ADR 0051, 2026-11-16).
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

/**
 * The instant of an audit entry's `at`, in milliseconds. The API sends an ISO instant with its `Z`
 * mark ("2026-11-16T09:30:00.000Z", ADR 0064); before, it sent the UTC minute with no mark
 * ("2026-11-16T09:30"), which is still read as UTC.
 */
export function auditTime(at: string): number {
  return /(Z|[+-]\d{2}:\d{2})$/.test(at) ? Date.parse(at) : Date.parse(`${at.slice(0, 16)}:00Z`);
}

/** The audit entries `actor` made with `action` from `since`'s minute on, read through the API as `request`'s person. */
export async function auditEntriesBy(
  request: APIRequestContext,
  action: string,
  actor: string,
  since: number,
): Promise<AuditEntry[]> {
  const from = Math.floor(since / 60_000) * 60_000;
  const entries = await readAs<AuditEntry[]>(request, "/audit");
  return entries.filter((entry) => entry.action === action && entry.actorName === actor && auditTime(entry.at) >= from);
}

/**
 * How many audit entries `actor` made with `action` from `since`'s minute on (the log keeps
 * minutes). Settings specs compare a count taken right after their heal with one taken at the end,
 * so a heal in the same minute doesn't count (ADR 0059 B9).
 */
export async function auditBy(
  request: APIRequestContext,
  action: string,
  actor: string,
  since: number,
): Promise<number> {
  return (await auditEntriesBy(request, action, actor, since)).length;
}

/**
 * A JSON value with its object keys sorted, so two answers compare whatever order jsonb kept: a
 * settings spec heals a section or tab only when `GET /settings` answers something else (ADR 0059).
 */
export function canonical(value: unknown): string {
  const sorted = (inner: unknown): unknown =>
    Array.isArray(inner)
      ? inner.map(sorted)
      : inner && typeof inner === "object"
        ? Object.fromEntries(
            Object.entries(inner)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : inner;
  return JSON.stringify(sorted(value));
}

/**
 * Puts one localization tab back to `value` unless `GET /settings` already answers it, through
 * `PUT /settings/localization/<tab>`. With `secret`, a save the API asks a step-up for (Currency
 * always, Region when the states of operation change; ADR 0059, part 2b) steps up and is sent again.
 * Returns the last answer, the read when nothing needed changing. The answer is read loosely, so the
 * settings specs build on code with or without a tab.
 */
export async function healTab(
  request: APIRequestContext,
  tab: string,
  value: object,
  secret?: string | null,
): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  const answer = (await read.json()) as { localization?: Record<string, unknown> };
  if (canonical(answer.localization?.[tab]) === canonical(value)) return read;
  const path = `/settings/localization/${tab}`;
  return secret ? putWithStepUp(request, secret, path, value) : request.put(`/api-proxy${path}`, { data: value });
}

/** `healTab` that throws unless the API answered 200, so a refused restore fails the clean-up. */
export async function healTabOrThrow(
  request: APIRequestContext,
  tab: string,
  value: object,
  secret?: string | null,
): Promise<APIResponse> {
  const response = await healTab(request, tab, value, secret);
  if (response.status() !== 200)
    throw new Error(`Putting ${tab} back answered ${response.status()}: ${await response.text()}`);
  return response;
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

/** Milliseconds until the next 30-second authenticator step starts, plus a second. */
export function untilNextStep(): number {
  return 30_000 - (Date.now() % 30_000) + 1_000;
}

/** A step-up with the next code; when the API refuses that code (used already), the next step's code. */
export async function stepUp(request: APIRequestContext, secret: string): Promise<void> {
  let response = await request.post("/api-proxy/auth/step-up", { data: { code: nextCode(secret) } });
  if (response.status() !== 204) {
    await new Promise((resolve) => setTimeout(resolve, untilNextStep()));
    response = await request.post("/api-proxy/auth/step-up", { data: { code: nextCode(secret) } });
  }
  expect(response.status(), `POST /auth/step-up answered ${response.status()}: ${await response.text()}`).toBe(204);
}

/**
 * A PUT to an `/api-proxy` route that needs a step-up: sent once, and when the API answers 403
 * `step_up_required`, stepped up with the next code and sent again. Returns the last answer.
 */
export async function putWithStepUp(
  request: APIRequestContext,
  secret: string,
  path: string,
  data: object,
): Promise<APIResponse> {
  const put = () => request.put(`/api-proxy${path}`, { data });
  const first = await put();
  if (first.status() !== 403 || (await first.json()).code !== "step_up_required") return first;
  await stepUp(request, secret);
  return put();
}

/**
 * Confirms the open step-up dialog with the next authenticator code and waits for it to close.
 * When the API refuses the code because it was used already ("That code is not right"), it waits
 * for the next 30-second step and confirms once more with that step's code.
 */
export async function confirmStepUp(page: Page, secret: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  const refused = dialog.getByText(/^That code is not right/);
  await dialog.getByLabel("Authenticator code").fill(nextCode(secret));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  // Each wait settles either way, so the one that loses the race is never an unhandled rejection.
  const closed = dialog.waitFor({ state: "hidden" }).then(
    () => "closed" as const,
    () => "unsettled" as const,
  );
  const wrong = refused.waitFor({ state: "visible" }).then(
    () => "refused" as const,
    () => "unsettled" as const,
  );
  if ((await Promise.race([closed, wrong])) === "refused") {
    await new Promise((resolve) => setTimeout(resolve, untilNextStep()));
    await dialog.getByLabel("Authenticator code").fill(nextCode(secret));
    await dialog.getByRole("button", { name: "Confirm" }).click();
  }
  await expect(dialog).toBeHidden();
}
