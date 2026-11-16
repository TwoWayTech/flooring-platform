import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
  AuditEntry,
  BusinessReport,
  InAppNotification,
  NotificationEventKey,
  OutboxAttachment,
  OutboxStatus,
  PayPeriod,
} from "@workspace/shared";
import type { PayPeriodReview } from "@/lib/api/contract";
import { companyToday, waitForAnswer } from "./kit";
import { ledgerDelta, ledgerMismatches, type ExpectedMoves, type TrialBalance } from "./ledger";

/** Reads an `/api-proxy` route as the request's person and returns its JSON, failing with the answer's text on anything but 200. */
async function readAs<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api-proxy${path}`);
  expect(response.status(), `GET ${path} answered ${response.status()}: ${await response.text()}`).toBe(200);
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
