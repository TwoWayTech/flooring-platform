import { randomInt } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
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

/** The seeded employee who signs in as EMPLOYEE_EMAIL, by the name HR screens, pay reviews and audit labels show. */
export const EMPLOYEE_NAME = "Bri Alvarez";

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

/** A seeded product a flow sells or orders: what to search for, its SKU (shown on the picker's option) and its line description. */
export interface SeededProduct {
  search: string;
  sku: string;
  /** "Brand name", as a quote or order line describes it. */
  line: string;
}

/** Fieldstone Sand Dune carpet (`sm-prd-0004`), 15 ft wide: two rolls at Denver Central in the seed. */
export const FIELDSTONE: SeededProduct = {
  search: "Fieldstone Sand Dune",
  sku: "LO-1893",
  line: "Loomcraft Fieldstone Sand Dune",
};

/** The LVP with an attached cork pad (`sm-prd-0062`): boxed goods, 28.50 sq ft a carton. */
export const CORK_LVP: SeededProduct = {
  search: "Attached Cork Pad",
  sku: "TV-3825",
  line: "Tidewater Vinyl Weathered Pier Sand Dune Wide Plank Rigid Core with Attached Cork Pad",
};

/** Adds `product` through the open quote's or order's Add product picker, choosing its option by SKU. */
export async function addProduct(page: Page, product: SeededProduct): Promise<void> {
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByPlaceholder("Search by name, color or brand").fill(product.search);
  await page.getByRole("option").filter({ hasText: product.sku }).click();
}

/** Opens the select `field` and picks the option named exactly `option`. */
export async function choose(page: Page, field: Locator, option: string): Promise<void> {
  await field.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Opens the Meetings page on the week `weeksAhead` weeks after this one. */
export async function openWeek(page: Page, weeksAhead: number): Promise<void> {
  await page.goto("/meetings");
  await expect(page.getByRole("button", { name: "New meeting" })).toBeVisible();
  for (let i = 0; i < weeksAhead; i += 1) await page.getByRole("button", { name: "Next week" }).click();
}

/** How long `waitForAnswer` waits by default: far longer than any screen's answer takes, far shorter than a flow. */
const ANSWER_TIMEOUT = 30_000;

/** How the browser reports a request the page dropped by navigating away (Chromium, Firefox, WebKit). */
const ABORTED = /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i;

/** A wait as its failure names it: the method, the path pattern without its anchors, and the query. */
function describeWait(method: string, path: RegExp, query: Readonly<Record<string, string>>): string {
  const pattern = path.source.replace(/^\^/, "").replace(/\$$/, "").replaceAll("\\/", "/");
  const search = new URLSearchParams(query).toString();
  return `${method} ${pattern}${search ? `?${search}` : ""}`;
}

/**
 * Arms a wait for the page's next `/api-proxy` answer to `method` on a path matching `path` (and,
 * when given, whose query holds each of `query`), and resolves to its JSON once it succeeded, or
 * rejects with the answer's text. Arm it before the action that sends the request, so the flow
 * checks what the screen was given rather than a hard-coded value. An answer whose body is gone
 * because the page navigated away from it (the previous screen's read, still in flight when a
 * `goto` starts) is passed over for the next one, and so is a matching request aborted that way.
 * It rejects with "<METHOD> <path><query>: no answer …" after `timeout` ms (30 s by default), and
 * also when the page closes or a matching request fails, so a failing flow stops at its step
 * instead of waiting out the test's timeout.
 */
export function waitForAnswer<T>(
  page: Page,
  method: string,
  path: RegExp,
  query: Readonly<Record<string, string>> = {},
  { timeout = ANSWER_TIMEOUT }: { timeout?: number } = {},
): Promise<T> {
  const what = describeWait(method, path, query);
  const answer = new Promise<T>((resolve, reject) => {
    let settled = false;
    const matches = (request: Request): boolean => {
      const url = new URL(request.url());
      return (
        request.method() === method &&
        path.test(url.pathname) &&
        Object.entries(query).every(([name, value]) => url.searchParams.get(name) === value)
      );
    };
    // Settles once: stops the clock and removes every listener, so nothing outlives the wait.
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
      page.off("close", onClose);
      return true;
    };
    const fail = (why: string): void => {
      if (settle()) reject(new Error(`${what}: ${why}`));
    };
    function onResponse(response: Response): void {
      if (settled || !matches(response.request())) return;
      const { pathname } = new URL(response.url());
      response.text().then(
        (text) => {
          if (!settle()) return;
          try {
            if (!response.ok()) throw new Error(`answered ${response.status()}: ${text}`);
            resolve(JSON.parse(text) as T);
          } catch (failure) {
            reject(new Error(`${method} ${pathname}: ${failure instanceof Error ? failure.message : text}`));
          }
        },
        () => undefined,
      );
    }
    function onFailed(request: Request): void {
      if (settled || !matches(request)) return;
      const reason = request.failure()?.errorText ?? "the request failed";
      if (!ABORTED.test(reason)) fail(reason);
    }
    function onClose(): void {
      fail("no answer before the page closed");
    }
    const timer = setTimeout(() => fail(`no answer within ${timeout / 1000} s`), timeout);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
    page.on("close", onClose);
  });
  // A step that fails between arming the wait and awaiting it leaves the wait unawaited; its later
  // rejection is then not an unhandled one. Whoever awaits `answer` still gets the rejection.
  answer.catch(() => undefined);
  return answer;
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
  // A stuck click or page load fails its step in 15 or 30 s instead of waiting out the flow's 90 to
  // 180 s; the api config sets neither. Set here, not by `use` in this shared module: a module loads
  // once, so its `use` would reach only the first spec file that imports it. They reach the persona
  // contexts too, which take the worker's context defaults.
  actionTimeout: 15_000,
  navigationTimeout: 30_000,
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

/** The hosts of a database on this machine, as a URL's `hostname` gives them. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The host a database URL names, or null when it isn't a URL. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The control database the API uses (global-setup.ts checks it is set). Off CI it must be on this
 * machine, since `resetAuthAround` wipes the personas' authenticators, passkeys and sessions; a URL
 * pointing anywhere else is refused. The message never repeats the URL, which holds a password.
 */
function controlUrl(): string {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error("Set CONTROL_DATABASE_URL to the control database the API uses.");
  if (process.env.CI || LOCAL_HOSTS.has(hostOf(url) ?? "")) return url;
  throw new Error(
    "CONTROL_DATABASE_URL must name localhost, 127.0.0.1 or ::1 outside CI: the flows reset sign-in state only on a local database.",
  );
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
