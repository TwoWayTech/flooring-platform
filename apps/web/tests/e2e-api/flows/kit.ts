import { randomInt } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import {
  addDays,
  defaultNumberSettings,
  formatNumber,
  mondayOf,
  type DecimalInput,
  type NumberKind,
} from "@workspace/shared";
import { signInAndEnrol, signInAs } from "../accounts";

export { addDays, mondayOf };

/** Summit's time zone: the config runs the browser here, and the company's day is the day here. */
export const COMPANY_ZONE = "America/Denver";

/**
 * A run id for a flow's own data: the time in base 36 plus two random base-36 characters, so two
 * runs (or a run and its CI retry) never share a name, reference or number.
 */
export function runId(): string {
  const suffix = randomInt(36 * 36)
    .toString(36)
    .padStart(2, "0");
  return `${Date.now().toString(36)}${suffix}`;
}

/** A tiny file that starts and ends like a real PDF, so the real-type check accepts it as a proof or receipt. */
export const PDF_PROOF = {
  name: "proof.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n%e2e flow proof\n%%EOF\n"),
};

/** The company's day (YYYY-MM-DD in Denver), the day every form defaults to and the API checks against. */
export function companyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: COMPANY_ZONE }).format(new Date());
}

/**
 * Fails when the flow crossed midnight in Denver after it started on `start`: its "this month"
 * reports, default dates and same-day rules would then compare two days. The CI retry runs it again.
 */
export function assertSameCompanyDay(start: string): void {
  expect(companyToday(), `the flow started on ${start} and crossed midnight in ${COMPANY_ZONE}; run it again`).toBe(
    start,
  );
}

/**
 * A Monday 8 to 84 days after Denver's today, chosen by the run. Two runs (or a run stopped midway,
 * whose cleanup may come after its context closed) then rarely book the same slot. `weeksAhead` is
 * how many times "Next week" moves from this week to that Monday (ADR 0051 "Part 3", S8).
 */
export function mondayForRun(run: string): { day: string; weeksAhead: number } {
  const weeksAhead = 2 + (parseInt(run.slice(-3), 36) % 11);
  return { day: addDays(mondayOf(companyToday()), weeksAhead * 7), weeksAhead };
}

/** "Jan 5, 2027": how the company's date format (MMM d, yyyy) shows a day. */
export function formatted(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How a number of `kind` shows on screen ("$1,234.50", "-$12.00", "53.00"): through `formatNumber`,
 * as `<Num>` does, before any unit it adds. Summit's seeded number settings are the US defaults
 * (money and quantities to 2 decimals, a minus sign, en-US, USD), and Settings is still DemoStore in
 * api mode, so the screen formats with exactly these.
 */
export function shown(value: DecimalInput, kind: NumberKind): string {
  return formatNumber(value, kind, defaultNumberSettings());
}

/** Opens the Meetings page on the week `weeksAhead` weeks after this one. */
export async function openWeek(page: Page, weeksAhead: number): Promise<void> {
  await page.goto("/meetings");
  await expect(page.getByRole("button", { name: "New meeting" })).toBeVisible();
  for (let i = 0; i < weeksAhead; i += 1) await page.getByRole("button", { name: "Next week" }).click();
}

/**
 * Arms a wait for the page's next `/api-proxy` answer to `method` on a path matching `path` (and,
 * when given, whose query holds each of `query`), and resolves to its JSON once it succeeded, or
 * rejects with the answer's text. Arm it before the action that sends the request, so the flow
 * checks what the screen was given rather than a hard-coded value. An answer whose body is gone
 * because the page navigated away from it (the previous screen's read, still in flight when a
 * `goto` starts) is passed over for the next one.
 */
export function waitForAnswer<T>(
  page: Page,
  method: string,
  path: RegExp,
  query: Readonly<Record<string, string>> = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onResponse = (response: Response): void => {
      const url = new URL(response.url());
      const matches =
        response.request().method() === method &&
        path.test(url.pathname) &&
        Object.entries(query).every(([name, value]) => url.searchParams.get(name) === value);
      if (settled || !matches) return;
      response.text().then(
        (text) => {
          if (settled) return;
          settled = true;
          page.off("response", onResponse);
          try {
            if (!response.ok()) throw new Error(`answered ${response.status()}: ${text}`);
            resolve(JSON.parse(text) as T);
          } catch (failure) {
            reject(new Error(`${method} ${url.pathname}: ${failure instanceof Error ? failure.message : text}`));
          }
        },
        () => undefined,
      );
    };
    page.on("response", onResponse);
  });
}

/** A seeded person signed in through the real login page, in a browser context the test owns. */
export interface Persona {
  email: string;
  context: BrowserContext;
  page: Page;
  /** The context's request client: it carries the person's session to `/api-proxy`. */
  request: APIRequestContext;
  /** The authenticator's setup key for a person who enrolled one (MFA roles), else null. */
  secret: string | null;
}

/** The personas a flow signs in, and the clean-ups it registers for a run that stops midway. */
export interface PersonaPool {
  /** Opens a context in Denver at 1440 × 900 and signs `email` in, enrolling an authenticator when `mfa`. */
  open(email: string, options?: { mfa?: boolean }): Promise<Persona>;
  /**
   * Registers a clean-up that undoes the flow's data through the product's API (void, cancel,
   * reopen, deactivate) if the journey did not get to do it on screen. It must be safe to repeat:
   * 400 and 409 (already done) are ignored.
   */
  onCleanup(label: string, run: () => Promise<APIResponse>): void;
}

/** Answers a registered clean-up may give: done now, or already done (refused as a repeat). */
function cleanupSettled(status: number): boolean {
  return (status >= 200 && status < 300) || status === 400 || status === 409;
}

/**
 * The flows' test: `personas` opens test-owned contexts, so the registered clean-ups still run
 * through the people's sessions after a step fails or the test times out, which the built-in `page`
 * fixture would not allow (STATUS R7, PR #37). Clean-ups run newest first, then the contexts close. A
 * clean-up that fails fails a test that had passed, and is noted on one that had already failed.
 */
export const flowTest = test.extend<{ personas: PersonaPool }>({
  personas: async ({ browser, baseURL }, provide, testInfo) => {
    const opened: Persona[] = [];
    const cleanups: { label: string; run: () => Promise<APIResponse> }[] = [];
    await provide({
      async open(email, { mfa = false } = {}) {
        const context = await browser.newContext({
          baseURL,
          timezoneId: COMPANY_ZONE,
          viewport: { width: 1440, height: 900 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        const persona: Persona = { email, context, page, request: context.request, secret: null };
        opened.push(persona);
        if (mfa) persona.secret = await signInAndEnrol(page, email);
        else await signInAs(page, email);
        return persona;
      },
      onCleanup(label, run) {
        cleanups.push({ label, run });
      },
    });
    const problems: string[] = [];
    for (const { label, run } of cleanups.reverse()) {
      try {
        const response = await run();
        if (!cleanupSettled(response.status()))
          problems.push(`${label}: ${response.status()} ${await response.text()}`);
      } catch (failure) {
        problems.push(`${label}: ${failure instanceof Error ? failure.message : String(failure)}`);
      }
    }
    for (const { context } of opened) await context.close();
    for (const problem of problems) testInfo.annotations.push({ type: "clean-up failed", description: problem });
    if (problems.length > 0 && testInfo.status === testInfo.expectedStatus)
      throw new Error(`Clean-up failed, so the flow left data behind: ${problems.join("; ")}`);
  },
});

/** The control database the API uses (global-setup.ts checks it is set). */
function controlUrl(): string {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error("Set CONTROL_DATABASE_URL to the control database the API uses.");
  return url;
}

/**
 * Resets the given people's sign-in state before and after the flows in this describe (MFA,
 * passkeys, sessions, failed attempts and the per-IP limit, as `reports.spec.ts` does). Each flow
 * then enrols afresh without waiting out the sign-in limit, and leaves no authenticator for
 * `login.spec.ts` and the specs after it.
 */
export function resetAuthAround(emails: readonly string[]): void {
  flowTest.beforeAll(async () => {
    await resetAuthState(controlUrl(), emails);
  });
  flowTest.afterAll(async () => {
    await resetAuthState(controlUrl(), emails);
  });
}
