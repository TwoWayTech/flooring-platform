import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { FEATURE_KEYS } from "@workspace/shared";
import { filesUnder, normalPath, readRepoFile, repoPath, withoutComments } from "./source";

/**
 * Which tests touch which page, route or feature, read from the tests' code only (whole-product
 * check, coverage list, ADR 0058). A test "touches" what its literals name: a page by a path it
 * opens, an API route by a path it requests, a feature by its key. Literals in the helper files a
 * test imports from its own folder count too, because those helpers send the requests. It is a
 * static index, so a route no literal names is reported as "needs a look", not as untested. Specs
 * name pages through `goto` and through sign-in helpers (`signInAs(page, persona, "/sales")`), so
 * any literal that opens a page counts, not only a `goto` argument.
 */

/** The kinds of test the coverage list reports, each with the folder and files it reads. */
export const TEST_KINDS = {
  unit: "Shared and web unit tests (packages/shared/test, apps/web/tests/unit)",
  integration: "API integration tests (apps/api/test/*.int.test.ts)",
  demoE2e: "Demo e2e (apps/web/tests/e2e)",
  apiE2e: "Api-mode e2e (apps/web/tests/e2e-api)",
} as const;

/** A kind of test. */
export type TestKind = keyof typeof TEST_KINDS;

/** What one test file touches. */
export interface TestFile {
  file: string;
  kind: TestKind;
  pages: string[];
  routes: string[];
  features: string[];
}

/** The literals the scan reads: quoted strings and template literals (with `${…}` kept). */
function literalsIn(code: string): string[] {
  return [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

/** The test file and the helpers it imports from its own test folder, transitively, as code without comments. */
function codeWithHelpers(file: string, root: string): string {
  const seen = new Set<string>();
  const queue = [file];
  const parts: string[] = [];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const code = withoutComments(readRepoFile(current));
    parts.push(code);
    for (const match of code.matchAll(/from\s*["'](\.\.?\/[^"']+)["']/g)) {
      const base = join(dirname(current), match[1] ?? "");
      const next = [`${base}.ts`, base].find(
        (candidate) => existsSync(repoPath(candidate)) && candidate.endsWith(".ts"),
      );
      if (next && next.startsWith(root) && !next.endsWith(".test.ts") && !next.endsWith(".spec.ts")) queue.push(next);
    }
  }
  return parts.join("\n");
}

/**
 * A spec's own code, plus the shared screen lists (`screens.ts`) when it imports them. Pages are
 * read from these only: sign-in helpers open /login for every spec, which would credit the login
 * page to all of them.
 */
function withScreenLists(file: string): string {
  const code = withoutComments(readRepoFile(file));
  const lists = /from\s*["']\.\/screens["']/.test(code)
    ? withoutComments(readRepoFile(join(dirname(file), "screens.ts")))
    : "";
  return `${code}\n${lists}`;
}

/** Matches a URL path (no query) against a page route whose `*` segments take any one segment. */
function routeMatches(route: string, path: string): boolean {
  const want = route.split("/");
  const have = path.split("/");
  return want.length === have.length && want.every((part, i) => part === "*" || part === have[i]);
}

/**
 * The page a literal opens, or null: the literal must start with `/`, and an exact page wins over
 * one with `*` (so `/sales/quotes/new` is the new-quote page, not a quote). The not-found page
 * never matches.
 */
export function pageFor(literal: string, pages: readonly string[]): string | null {
  if (!literal.startsWith("/") || literal.startsWith("//")) return null;
  const path = (literal.split(/[?#]/)[0] ?? "").replace(/\$\{[^}]*\}/g, "x").replace(/\/+$/, "") || "/";
  const candidates = pages.filter((page) => !page.includes("[") && routeMatches(page, path));
  return candidates.find((page) => !page.includes("*")) ?? candidates[0] ?? null;
}

/** A literal's API path with UUIDs as parameters, normalised as the route catalog writes paths. */
function apiPath(literal: string): string {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  return normalPath(literal.replace(uuid, ":p"));
}

/** The routes whose path a literal names, any verb. */
function routesNamed(literals: readonly string[], routesByPath: ReadonlyMap<string, string[]>): string[] {
  const found = new Set<string>();
  for (const literal of literals) {
    if (!literal.startsWith("/")) continue;
    for (const route of routesByPath.get(apiPath(literal)) ?? []) found.add(route);
  }
  return [...found].sort();
}

/** The API paths an api-mode spec names through the web's proxy, as strings, templates or regular expressions. */
function proxiedPaths(code: string): string[] {
  const proxy = /api-proxy((?:(?:\\\/|\/)(?:\$\{[^}]*\}|\[\^\/\]\+|[\w.-])+)+)/g;
  return [...code.matchAll(proxy)].map((match) => (match[1] ?? "").replace(/\\\//g, "/").replace(/\[\^\/\]\+/g, ":p"));
}

/** Every page a test file's literals open, sorted. */
function pagesNamed(literals: readonly string[], pages: readonly string[]): string[] {
  const found = new Set<string>();
  for (const literal of literals) {
    const page = pageFor(literal, pages);
    if (page) found.add(page);
  }
  return [...found].sort();
}

/** The check's own tests and lists, which name every page and feature by design and so are left out of "named in". */
const SELF =
  /^apps\/web\/tests\/unit\/(coverage-scan\/|coverage-list\.test\.ts$|page-gates\.test\.ts$|money-in-ui\.test\.ts$)/;

/**
 * Every test file of the four kinds with what it touches. `pages` are the page routes the scan
 * found; `routes` are the catalog's `VERB /path` names.
 */
export function indexTests(pages: readonly string[], routes: readonly string[]): TestFile[] {
  const routesByPath = new Map<string, string[]>();
  for (const route of routes) {
    const path = normalPath(route.slice(route.indexOf(" ") + 1));
    routesByPath.set(path, [...(routesByPath.get(path) ?? []), route]);
  }
  const featureKeys = new Set<string>(FEATURE_KEYS);
  const unitFiles = [
    ...filesUnder("packages/shared/test", (path) => path.endsWith(".test.ts")),
    ...filesUnder("apps/web/tests/unit", (path) => /\.test\.tsx?$/.test(path) && !SELF.test(path)),
  ];
  const unit = unitFiles.map((file): TestFile => {
    const literals = literalsIn(withoutComments(readRepoFile(file)));
    return {
      file,
      kind: "unit",
      pages: pagesNamed(literals, pages),
      routes: [],
      features: [...new Set(literals.filter((literal) => featureKeys.has(literal)))].sort(),
    };
  });
  const integration = filesUnder("apps/api/test", (path) => /^apps\/api\/test\/[^/]+\.int\.test\.ts$/.test(path)).map(
    (file): TestFile => ({
      file,
      kind: "integration",
      pages: [],
      routes: routesNamed(literalsIn(codeWithHelpers(file, "apps/api/test/")), routesByPath),
      features: [],
    }),
  );
  const demoE2e = filesUnder("apps/web/tests/e2e", (path) => path.endsWith(".spec.ts")).map((file): TestFile => {
    const literals = file in PARKED_SPECS ? [] : literalsIn(withScreenLists(file));
    return { file, kind: "demoE2e", pages: pagesNamed(literals, pages), routes: [], features: [] };
  });
  const apiE2e = filesUnder("apps/web/tests/e2e-api", (path) => path.endsWith(".spec.ts")).map((file): TestFile => {
    const parked = file in PARKED_SPECS;
    return {
      file,
      kind: "apiE2e",
      pages: parked ? [] : pagesNamed(literalsIn(withScreenLists(file)), pages),
      routes: parked ? [] : routesNamed(proxiedPaths(codeWithHelpers(file, "apps/web/tests/e2e-api/")), routesByPath),
      features: [],
    };
  });
  return [...unit, ...integration, ...demoE2e, ...apiE2e];
}

/**
 * Spec files skipped as a whole (`fixme`) until the product bugs they name are fixed, each with
 * why. They credit no page or route, so the coverage list never counts a test that doesn't run
 * (MF-7). CV-9 fails on a spec with a `.fixme(` that isn't listed, and on a listed file without one.
 */
export const PARKED_SPECS: Readonly<Record<string, string>> = {
  "apps/web/tests/e2e-api/flows/f1-sales-quote-to-cut.spec.ts":
    "F1 is fixme until B1, B2 and B3 are fixed (docs/STATUS.md; the flows' session log).",
  "apps/web/tests/e2e-api/flows/f2-purchasing-receipt-to-payment.spec.ts":
    "F2 is fixme until B2 is fixed (docs/STATUS.md; the flows' session log).",
  "apps/web/tests/e2e-api/flows/f5-contract-retainage.spec.ts":
    "F5 is fixme until B4 and B2 are fixed (docs/STATUS.md; the flows' session log).",
};

/** Whether a spec file declares a test as `fixme` (outside comments): it is then parked as a whole. */
export function hasFixme(file: string): boolean {
  return /\.fixme\(/.test(withoutComments(readRepoFile(file)));
}

/**
 * Test files that touch the whole product rather than named pages or routes, each with why. CV-6
 * fails on an integration or api-mode e2e file that is neither indexed nor listed here, and on an
 * entry that is indexed after all.
 */
export const CROSS_CUTTING: Readonly<Record<string, string>> = {
  "apps/api/test/lockout.int.test.ts":
    "Sign-in lockout and rate limits on Better Auth's /api/auth routes, which the route catalog leaves out.",
};
