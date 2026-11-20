import { expect } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import { featureForPath, featureOn, PRODUCT_ROLES, type DefaultRoleKey } from "@workspace/shared";
import {
  ACCOUNTANT_EMAIL,
  EMPLOYEE_EMAIL,
  HR_EMAIL,
  INSTALLER_EMAIL,
  MANAGER_EMAIL,
  OWNER_EMAIL,
  PURCHASING_EMAIL,
  SALES_EMAIL,
  WAREHOUSE_EMAIL,
} from "../accounts";
import { flowTest } from "../flows/kit";
import { assertThrowawayDb, checkOnly } from "./opt-in";
import {
  addressOf,
  errorToasts,
  gatedPages,
  loadFailures,
  matrixAllows,
  openAndSettle,
  signInFresh,
  staticRoutes,
  watchProxy,
  type PageState,
  type ProxyLog,
} from "./page-walk";

/** Summit's seeded person for each default flooring role (pnpm db:seed). */
const SUMMIT_PERSONAS: Readonly<Record<DefaultRoleKey, string>> = {
  owner: OWNER_EMAIL,
  manager: MANAGER_EMAIL,
  accountant: ACCOUNTANT_EMAIL,
  sales: SALES_EMAIL,
  purchasing: PURCHASING_EMAIL,
  warehouse: WAREHOUSE_EMAIL,
  installer: INSTALLER_EMAIL,
  hr: HR_EMAIL,
  employee: EMPLOYEE_EMAIL,
};

/**
 * Writes a page sends just by being opened, each with why (reviewed). Any other write seen while
 * walking fails the walk: opening pages must not change Summit.
 */
const ON_OPEN_WRITES: Readonly<Record<string, string>> = {
  "POST /pay-periods":
    'Listing pay periods opens the one holding today first, and ignores a refusal (listPayPeriods in api-methods.ts; hr.md "Pay periods", Create).',
};

/** Why Settings home refuses a role page-gates.json lets in: stricter than the gate, so safe. */
const SETTINGS_HOME =
  "Settings home shows NoAccess when the person may open no settings group (settings-home.tsx); canOpenPage has no rule for /settings, so PG-3 lets every role in. Stricter than the gate, so nothing is exposed.";

/**
 * Where the running app disagrees with page-gates.json, or an open page's read fails, keyed
 * `<role> <page>: <what>`, each with why (reviewed). A new disagreement fails the walk, and so does
 * an entry that no longer happens, so the list stays exact.
 */
const RUNTIME_MISMATCHES: Readonly<Record<string, string>> = {
  "employee /settings: refused, page-gates.json says open": SETTINGS_HOME,
  "installer /settings: refused, page-gates.json says open": SETTINGS_HOME,
  "purchasing /settings: refused, page-gates.json says open": SETTINGS_HOME,
  "sales /settings: refused, page-gates.json says open": SETTINGS_HOME,
  "warehouse /settings: refused, page-gates.json says open": SETTINGS_HOME,
};

/**
 * How a page should end up: switched off when the feature register switches its feature off
 * (PageGate checks the switch before the role; CLAUDE.md rule 13), else as page-gates.json says.
 */
function expectedState(href: string, opens: boolean): PageState {
  const feature = featureForPath("flooring", href);
  if (href !== "/" && feature && !featureOn(feature)) return "switched off";
  return opens ? "open" : "refused";
}

/** What one page showed one role: its problems, as `<role> <page>: <what>`, and the 403s PG-4 foresaw. */
interface PageVerdict {
  problems: string[];
  tolerated: string[];
}

/** What a page showed, beyond its state: the failed reads' messages, the error toasts and its traffic. */
interface PageSeen {
  state: PageState;
  failures: string[];
  toasts: string[];
  log: ProxyLog;
}

/**
 * Judges one opened page for one role against page-gates.json, the route matrix and the coverage
 * scan. `href` is the address typed and `landed` the page it ended on (a redirect is judged by
 * where it lands).
 */
function judgePage(role: string, href: string, landed: string, expected: PageState, seen: PageSeen): PageVerdict {
  const at = `${role} ${href}`;
  const { state, failures, toasts, log } = seen;
  const problems: string[] = [];
  const tolerated: string[] = [];
  if (state !== expected) {
    const why = failures.length > 0 ? ` (${failures.join("; ")})` : "";
    problems.push(`${at}: ${state}${why}, page-gates.json says ${expected}`);
  }
  for (const toast of toasts) problems.push(`${at}: error toast "${toast}"`);
  for (const write of log.writes) if (!(write in ON_OPEN_WRITES)) problems.push(`${at}: sent ${write} on opening`);
  for (const answer of log.answers) {
    const route = answer.route ?? `${answer.method} ${answer.path} (not in the catalog)`;
    if (answer.status >= 500) problems.push(`${at}: ${route} answered ${answer.status}`);
    // Reads only: a reviewed on-open write handles its own refusal.
    if (answer.method !== "GET" || answer.status < 400 || answer.status >= 500 || expected !== "open") continue;
    if (answer.status !== 403) {
      problems.push(`${at}: ${route} answered ${answer.status}`);
    } else if (state !== "open" || toasts.length > 0) {
      problems.push(`${at}: ${route} refused behind a visible error`);
    } else if (matrixAllows(route, "flooring", role) !== false) {
      problems.push(`${at}: ${route} refused, though the route matrix lets ${role} in`);
    } else if (!staticRoutes(landed).has(route)) {
      problems.push(`${at}: ${route} refused, and the coverage scan doesn't list it for this page`);
    } else {
      tolerated.push(route);
    }
  }
  return { problems, tolerated };
}

// No traces: every persona types the seeded password at sign-in, and the check keeps no password
// in its artifacts (ADR 0058, S-7). Playwright allows `trace` only at the top of a file.
flowTest.use({ trace: "off" });

// The page × persona matrix at run time (whole-product check PGM-1; plan section 5.4; ADR 0058):
// each of Summit's nine flooring personas opens every flooring page page-gates.json lists (PG-3,
// pages that need a record left out) by typing its address. A page the snapshot refuses must show
// "You don't have access to this page."; a page it opens must render with no failed read, no error
// toast and no 403 the static join (PG-4) didn't foresee; a page whose feature is switched off must
// say so. A redirect is judged by the page it lands on. Opening pages must write nothing but the
// reviewed on-open writes. Opt-in (`WHOLE_CHECK=1`); every persona's sign-in state is reset before
// and after.
flowTest.describe("the page-gate matrix at run time (whole-product check PGM)", { tag: "@check" }, () => {
  checkOnly();
  flowTest.describe.configure({ timeout: 420_000 });

  flowTest.afterAll(async () => {
    await resetAuthState(assertThrowawayDb().controlUrl, Object.values(SUMMIT_PERSONAS));
  });

  for (const role of PRODUCT_ROLES.flooring) {
    flowTest(`PGM-1, ${role}: every flooring page opens or refuses as page-gates.json says`, async ({ personas }) => {
      const persona = await signInFresh(personas, assertThrowawayDb(), SUMMIT_PERSONAS[role], role);
      const log = watchProxy(persona.page);
      const problems = new Set<string>();
      const tolerated = new Map<string, Set<string>>();
      const redirects: string[] = [];
      const counts = new Map<PageState, number>();
      const gates = gatedPages("flooring");
      for (const href of gates.keys()) {
        log.clear();
        const state = await openAndSettle(persona.page, href);
        if (state === "signed out") throw new Error(`${role} was signed out on ${href}`);
        const landed = addressOf(persona.page);
        if (landed !== href) redirects.push(`${href} → ${landed}`);
        const roles = gates.get(landed);
        if (!roles) {
          problems.add(`${role} ${href}: landed on ${landed}, which page-gates.json doesn't list`);
          continue;
        }
        const expected = expectedState(landed, roles.includes(role));
        counts.set(expected, (counts.get(expected) ?? 0) + 1);
        const seen: PageSeen = {
          state,
          failures: state === "could not load" ? await loadFailures(persona.page) : [],
          toasts: await errorToasts(persona.page),
          log,
        };
        const judged = judgePage(role, href, landed, expected, seen);
        for (const problem of judged.problems) problems.add(problem);
        for (const route of judged.tolerated) tolerated.set(route, (tolerated.get(route) ?? new Set()).add(href));
      }
      const annotate = (type: string, description: string) => flowTest.info().annotations.push({ type, description });
      annotate(
        "walked",
        `${role}: ${gates.size} pages, expected ${[...counts].map(([state, n]) => `${n} ${state}`).join(", ")}`,
      );
      if (redirects.length > 0) annotate("redirects", `${role}: ${redirects.join(", ")}`);
      for (const [route, hrefs] of tolerated)
        annotate(
          "tolerated 403",
          `${role}: ${route} on ${[...hrefs].join(", ")} (softened by the client or in TOLERATED_REFUSALS)`,
        );
      const found = [...problems].sort();
      expect
        .soft(
          found.filter((problem) => !(problem in RUNTIME_MISMATCHES)),
          "new runtime mismatches",
        )
        .toEqual([]);
      const stale = Object.keys(RUNTIME_MISMATCHES).filter((key) => key.startsWith(`${role} `) && !problems.has(key));
      expect(stale, "RUNTIME_MISMATCHES entries that no longer happen").toEqual([]);
    });
  }
});
