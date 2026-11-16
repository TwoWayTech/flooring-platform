import { beforeAll, describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURES } from "@workspace/shared";
import { apiClientMembers, apiMethodKeys } from "./coverage-scan/api-paths";
import { CLIENT_LOCAL, DEMO_ONLY } from "./coverage-scan/demo-only";
import { buildCoverage, type CoverageModel } from "./coverage-scan/model";
import { REGENERATE, renderMarkdown, renderPageCoverage } from "./coverage-scan/render";
import { NO_FEATURE_PAGES, SHELL_GROUP, SPEC_FEATURES, specFiles } from "./coverage-scan/spec-features";
import { CROSS_CUTTING } from "./coverage-scan/test-index";

/**
 * The coverage list (whole-product check, ADR 0058): which pages, features and routes are on the
 * API and which tests touch them, generated from code into docs/coverage.md and
 * tests/e2e-api/check/page-coverage.json so it can't drift. It also fails when a screen calls
 * something that is neither on the API nor reviewed as demo-only (CLAUDE.md rule 1), and when the
 * web client calls an API path the route catalog doesn't have.
 */

const ADD_IT =
  "Add it to API_METHODS, or to tests/unit/coverage-scan/demo-only.ts with a reason and a STATUS follow-up.";

let model: CoverageModel;

beforeAll(async () => {
  model = await buildCoverage();
});

/** Where each offending target is called, as `target  file:line` lines. */
function whereCalled(targets: readonly string[]): string[] {
  return targets.flatMap((target) => {
    const calls = model.screens.flatMap((screen) => screen.calls).filter((call) => call.target === target);
    return [...new Set(calls.map((call) => `${target}  ${call.file}:${call.line}`))];
  });
}

describe("coverage list (CV-1 to CV-8)", () => {
  it("CV-1: every method a screen reaches is on the API, reviewed as demo-only, or client-local", () => {
    const members = new Set(apiClientMembers());
    const notClient = [...model.targets.keys()].filter((target) => !members.has(target.split(":")[0] ?? ""));
    expect(notClient, "calls on a name the scan took for the ApiClient that isn't one of its methods").toEqual([]);
    const unreviewed = [...model.targets]
      .filter(([target, state]) => state === "demo" && !/^(list|get):/.test(target) && !(target in DEMO_ONLY))
      .map(([target]) => target);
    expect(whereCalled(unreviewed), ADD_IT).toEqual([]);
  });

  it("CV-2: every collection a screen lists or gets is served by the API or reviewed as demo-only", () => {
    const unnamed = [...model.targets.keys()].filter((target) => target.endsWith(":?"));
    expect(whereCalled(unnamed), "list, get or save without a literal collection: name it at the call").toEqual([]);
    const unreviewed = [...model.targets]
      .filter(([target, state]) => state === "demo" && /^(list|get):/.test(target) && !(target in DEMO_ONLY))
      .map(([target]) => target);
    expect(whereCalled(unreviewed), ADD_IT).toEqual([]);
  });

  it("CV-3: DEMO_ONLY has no stale entry: each one is called by a screen and still stays on DemoStore", () => {
    const stale = Object.keys(DEMO_ONLY).filter((target) => model.targets.get(target) !== "demo");
    expect(stale, "on the API now, or no screen calls it: remove it from demo-only.ts").toEqual([]);
    const staleLocal = Object.keys(CLIENT_LOCAL).filter((method) => !apiClientMembers().includes(method));
    expect(staleLocal, "CLIENT_LOCAL names a method the ApiClient no longer has").toEqual([]);
  });

  it("CV-4: every API_METHODS key is an ApiClient method and every path it calls is in the route catalog", () => {
    const members = new Set(apiClientMembers());
    expect(apiMethodKeys().filter((key) => !members.has(key))).toEqual([]);
    expect(model.unknownRoutes, "a web method calls a route apps/api doesn't have").toEqual([]);
    expect(
      model.unresolved,
      "a computed path: add the method to RESOLVED_ELSEWHERE in coverage-scan/api-paths.ts",
    ).toEqual([]);
    expect(model.staleElsewhere, "now a literal path the catalog has: remove it from RESOLVED_ELSEWHERE").toEqual([]);
  });

  it("CV-5: every page has a feature, and every feature sits under exactly one spec", () => {
    const pages = model.screens.filter((screen) => screen.kind === "page");
    const orphans = pages.filter((page) => page.features.length === 0 && !(page.route in NO_FEATURE_PAGES));
    expect(
      orphans.map((page) => page.route),
      "give the page a feature screen, or add it to NO_FEATURE_PAGES",
    ).toEqual([]);
    const staleNoFeature = Object.keys(NO_FEATURE_PAGES).filter(
      (route) => !pages.some((page) => page.route === route && page.features.length === 0),
    );
    expect(staleNoFeature, "NO_FEATURE_PAGES names a page that is gone or has a feature now").toEqual([]);

    const listed = Object.values(SPEC_FEATURES).flat();
    const unknown = listed.filter((key) => !(FEATURE_KEYS as readonly string[]).includes(key));
    const twice = listed.filter((key, i) => listed.indexOf(key) !== i);
    const missing = FEATURE_KEYS.filter((key) => FEATURES[key].status !== "removed" && !listed.includes(key));
    expect({ unknown, twice, missing }, "fix SPEC_FEATURES in coverage-scan/spec-features.ts").toEqual({
      unknown: [],
      twice: [],
      missing: [],
    });
    const groups = Object.keys(SPEC_FEATURES).filter((group) => group !== SHELL_GROUP);
    expect(groups.sort(), "every spec file has an entry, and every entry is a spec file").toEqual(specFiles().sort());
  });

  it("CV-6: every API integration and api-mode e2e file is indexed to a route or page, or is cross-cutting", () => {
    const checked = model.tests.filter((test) => test.kind === "integration" || test.kind === "apiE2e");
    const indexed = (file: string) => {
      const test = checked.find((t) => t.file === file);
      return test !== undefined && test.routes.length + test.pages.length > 0;
    };
    const unindexed = checked.filter((test) => !indexed(test.file) && !(test.file in CROSS_CUTTING));
    expect(
      unindexed.map((test) => test.file),
      "add the file to CROSS_CUTTING in coverage-scan/test-index.ts with why",
    ).toEqual([]);
    const stale = Object.keys(CROSS_CUTTING).filter((file) => !checked.some((t) => t.file === file) || indexed(file));
    expect(stale, "CROSS_CUTTING names a file that is gone or indexed now").toEqual([]);
  });

  it("CV-7: docs/coverage.md and page-coverage.json are up to date", async () => {
    const hint = `Regenerate with: ${REGENERATE}`;
    await expect(renderMarkdown(model), hint).toMatchFileSnapshot("../../../../docs/coverage.md");
    await expect(renderPageCoverage(model), hint).toMatchFileSnapshot("../e2e-api/check/page-coverage.json");
  });

  it("CV-8: the scan finds a sane amount, so a broken pattern can't make every check pass", () => {
    const pages = model.screens.filter((screen) => screen.kind === "page");
    const files = (kind: string) => model.tests.filter((test) => test.kind === kind).length;
    expect(model.targets.size).toBeGreaterThanOrEqual(150);
    expect(pages.length).toBeGreaterThanOrEqual(60);
    expect(model.routes.length).toBeGreaterThanOrEqual(180);
    expect(files("integration")).toBeGreaterThanOrEqual(30);
    expect(files("apiE2e")).toBeGreaterThanOrEqual(14);
  });
});
