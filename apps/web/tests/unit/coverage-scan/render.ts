import { FEATURES } from "@workspace/shared";
import { DEMO_ONLY, DEMO_REASONS, type DemoReasonId } from "./demo-only";
import type { CoverageModel, ScreenCoverage } from "./model";
import { SPEC_FEATURES } from "./spec-features";
import { PARKED_SPECS, TEST_KINDS, type TestKind } from "./test-index";

/**
 * Writes the coverage model out (whole-product check, ADR 0058): docs/coverage.md for people and
 * page-coverage.json for the api-mode check specs. Rows are sorted and there are no dates, timings
 * or line numbers, so the files change only when the code does.
 */

/** The command that regenerates both files. */
export const REGENERATE = "pnpm --filter web exec vitest run tests/unit/coverage-list.test.ts -u";

const code = (text: string) => `\`${text}\``;
const list = (items: readonly string[], empty = "—") => (items.length === 0 ? empty : items.map(code).join(", "));
const short = (file: string) => file.slice(file.lastIndexOf("/") + 1);
const names = (files: readonly string[]) => (files.length === 0 ? "—" : files.map(short).map(code).join(", "));
const row = (cells: readonly (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]) =>
  [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");

/** The test files of one kind that touch a page. */
function pageTests(model: CoverageModel, page: string, kind: TestKind): string[] {
  return model.tests.filter((test) => test.kind === kind && test.pages.includes(page)).map((test) => test.file);
}

/** A target with its demo reason id, as the page tables show it. */
function withReason(target: string): string {
  const reason: DemoReasonId | undefined = DEMO_ONLY[target];
  return reason ? `${code(target)} (${reason})` : code(target);
}

function summary(model: CoverageModel, pages: readonly ScreenCoverage[]): string {
  const count = (state: string) => pages.filter((page) => page.classification === state).length;
  const targets = [...model.targets.values()];
  const apiPages = pages.filter((page) => page.classification === "api" || page.classification === "mixed");
  const routesUntested = model.routes.filter((r) => r.tests.integration.length === 0 && r.tests.apiE2e.length === 0);
  return table(
    ["What", "Count"],
    [
      ["Pages on the API", count("api")],
      ["Pages on the API that still read DemoStore (mixed)", count("mixed")],
      ["Demo-only pages (no call on the API, or hidden in api mode)", count("demo-only")],
      ["Pages with no ApiClient call", count("no data")],
      ["Distinct screen calls on the API", targets.filter((state) => state === "api").length],
      ["Distinct screen calls on DemoStore (reviewed)", targets.filter((state) => state === "demo").length],
      ["Distinct client-local calls", targets.filter((state) => state === "client").length],
      ["API routes in the catalog", model.routes.length],
      ["Routes a screen calls", model.routes.filter((r) => r.screens.length > 0).length],
      ["Routes no screen calls", model.routes.filter((r) => r.screens.length === 0).length],
      ["Routes no API test names (needs a look)", routesUntested.length],
      [
        "Pages on the API with no api-mode e2e",
        apiPages.filter((p) => pageTests(model, p.route, "apiE2e").length === 0).length,
      ],
    ],
  );
}

function bySpec(model: CoverageModel, pages: readonly ScreenCoverage[]): string {
  const standing = (route: string) => pages.find((page) => page.route === route)?.classification ?? "?";
  const sections = Object.entries(SPEC_FEATURES).map(([spec, keys]) => {
    const rows = keys.map((key) => {
      const feature = model.features.find((f) => f.key === key);
      if (!feature) return [code(key), "?", "—", 0, 0, 0, 0, 0];
      return [
        code(key),
        FEATURES[key].status,
        feature.pages.map((page) => `${code(page)} (${standing(page)})`).join(", ") || "—",
        feature.routes.length,
        feature.tests.unit.length,
        feature.tests.integration.length,
        feature.tests.demoE2e.length,
        feature.tests.apiE2e.length,
      ];
    });
    const head = ["Feature", "Status", "Pages (standing)", "Routes", "Unit", "Integration", "Demo e2e", "Api-mode e2e"];
    return `### ${spec.startsWith("docs/") ? code(spec) : spec}\n\n${table(head, rows)}`;
  });
  return sections.join("\n\n");
}

function screenRows(model: CoverageModel, screens: readonly ScreenCoverage[]): string {
  const rows = screens.map((screen) => [
    code(screen.route),
    screen.hiddenInApiMode ? `${screen.classification} (hidden in api mode)` : screen.classification,
    list(screen.onApi),
    screen.onDemo.length === 0 ? "—" : screen.onDemo.map(withReason).join(", "),
    names(pageTests(model, screen.route, "unit")),
    names(pageTests(model, screen.route, "demoE2e")),
    names(pageTests(model, screen.route, "apiE2e")),
  ]);
  return table(
    ["Page", "Standing", "Calls on the API", "Calls on DemoStore (reason)", "Unit", "Demo e2e", "Api-mode e2e"],
    rows,
  );
}

function layoutRows(layouts: readonly ScreenCoverage[]): string {
  return table(
    ["Layout", "Standing", "Calls on the API", "Calls on DemoStore (reason)"],
    layouts.map((layout) => [
      code(layout.route),
      layout.classification,
      list(layout.onApi),
      layout.onDemo.length === 0 ? "—" : layout.onDemo.map(withReason).join(", "),
    ]),
  );
}

function demoOnly(): string {
  const ids = Object.keys(DEMO_REASONS) as DemoReasonId[];
  return table(
    ["Reason", "Why", "Tracked by", "Calls"],
    ids.map((id) => [
      code(id),
      DEMO_REASONS[id].reason,
      DEMO_REASONS[id].status,
      list(Object.keys(DEMO_ONLY).filter((target) => DEMO_ONLY[target] === id)),
    ]),
  );
}

function routeRows(model: CoverageModel): string {
  return table(
    ["Route", "Level", "Keys", "Module", "Product", "Switches", "Screens", "Integration tests", "Api-mode e2e"],
    model.routes.map(({ route, requirement, screens, tests }) => [
      code(route),
      requirement.level,
      requirement.anyMember ? "any member" : list(requirement.anyOf),
      requirement.module ?? "—",
      requirement.product ?? "—",
      requirement.features === null
        ? "—"
        : list(
            Object.entries(requirement.features).map(([key, effect]) => `${key} ${effect}`),
            "none",
          ),
      list(screens),
      names(tests.integration),
      names(tests.apiE2e),
    ]),
  );
}

function gaps(model: CoverageModel, pages: readonly ScreenCoverage[]): string {
  const mixed = pages.filter((page) => page.classification === "mixed");
  const apiPages = pages.filter((page) => page.classification === "api" || page.classification === "mixed");
  const noE2e = apiPages.filter((page) => pageTests(model, page.route, "apiE2e").length === 0);
  const untested = model.routes.filter((r) => r.tests.integration.length === 0 && r.tests.apiE2e.length === 0);
  const noRoute = model.features.filter((f) => FEATURES[f.key].status !== "removed" && f.routes.length === 0);
  const unused = model.routes.filter((r) => r.screens.length === 0);
  const bullets = (items: readonly string[]) =>
    items.length === 0 ? "None." : items.map((item) => `- ${item}`).join("\n");
  return [
    "### Mixed pages and what they still read from DemoStore",
    bullets(mixed.map((page) => `${code(page.route)}: ${page.onDemo.map(withReason).join(", ")}`)),
    "### Pages on the API with no api-mode e2e",
    bullets(noE2e.map((page) => `${code(page.route)} (${page.classification})`)),
    "### Routes no API test names (needs a look)",
    "The index reads literals, so a route reached only through the route matrix, a probe or a computed path shows here.",
    bullets(untested.map((r) => code(r.route))),
    "### Features not removed that no route serves",
    "Their switch is read by no route (PM-5), so they are demo-only, shell-only or switched in a service.",
    bullets(noRoute.map((f) => `${code(f.key)} (${FEATURES[f.key].status})`)),
    "### Specs parked as fixme (credit nothing)",
    "A spec skipped as a whole doesn't run, so it counts toward no page or route above until its bugs are fixed.",
    bullets(Object.entries(PARKED_SPECS).map(([file, why]) => `${code(file)}: ${why}`)),
    "### Routes no screen calls",
    "No page reaches them through the ApiClient. Sign-in and the session (`apps/web/src/lib/session`) call `/auth/context`, `/platform/me` and the public invitation routes directly, so those show here too.",
    bullets(unused.map((r) => `${code(r.route)} (${r.requirement.level})`)),
  ].join("\n\n");
}

/** docs/coverage.md, entirely generated. */
export function renderMarkdown(model: CoverageModel): string {
  const pages = model.screens.filter((screen) => screen.kind === "page");
  const layouts = model.screens.filter((screen) => screen.kind === "layout");
  const kinds = (Object.keys(TEST_KINDS) as TestKind[]).map((kind) => `  - **${kind}:** ${TEST_KINDS[kind]}`);
  return [
    "# Coverage list",
    "",
    `Generated by \`apps/web/tests/unit/coverage-list.test.ts\` from code only (whole-product check, ADR 0058). **Do not edit.** Regenerate with \`${REGENERATE}\` and review the diff.`,
    "",
    "- **Sources:** the pages and layouts under `apps/web/src/app` and the files they import (a static scan); `API_METHODS` and a probe of `list` and `get`; the route catalog snapshot `apps/api/test/__snapshots__/route-requirements.json` (guard decisions only); `packages/shared/src/features.ts`; the reviewed lists in `apps/web/tests/unit/coverage-scan/`; the tests' literals.",
    "- **Standing of a page in api mode:** `api` (every data call on the API), `mixed` (on the API, but some reads still come from DemoStore), `demo-only` (no call on the API, or hidden in api mode) or `no data`. A page is judged as a whole, every view together. Every page under `(app)` also runs the `(app)` layout (the shell), listed separately.",
    "- **Test kinds:**",
    ...kinds,
    "",
    "## Summary",
    "",
    summary(model, pages),
    "",
    "## By spec and feature",
    "",
    "Counts of test files; a feature's routes are those whose switch it is (the route matrix's PM-5).",
    "",
    bySpec(model, pages),
    "",
    "## By page",
    "",
    screenRows(model, pages),
    "",
    "### Layouts",
    "",
    layoutRows(layouts),
    "",
    "## Calls that stay on DemoStore in api mode",
    "",
    demoOnly(),
    "",
    "## API routes",
    "",
    routeRows(model),
    "",
    "## Gaps",
    "",
    gaps(model, pages),
    "",
  ].join("\n");
}

/** page-coverage.json: each page's standing in api mode, for the api-mode check specs and the report. */
export function renderPageCoverage(model: CoverageModel): string {
  const entry = (screen: ScreenCoverage) => ({
    file: screen.file,
    classification: screen.classification,
    hiddenInApiMode: screen.hiddenInApiMode,
    layouts: screen.layouts,
    onApi: screen.onApi,
    onDemo: screen.onDemo,
    routes: screen.routes,
  });
  const of = (kind: ScreenCoverage["kind"]) =>
    Object.fromEntries(
      model.screens.filter((screen) => screen.kind === kind).map((screen) => [screen.route, entry(screen)]),
    );
  const document = {
    note: `Generated by apps/web/tests/unit/coverage-list.test.ts (whole-product check, ADR 0058). Do not edit; regenerate with: ${REGENERATE}`,
    pages: of("page"),
    layouts: of("layout"),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
