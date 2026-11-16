import { FEATURES, FEATURE_KEYS, pagePatternScore, type FeatureKey } from "@workspace/shared";
import { PRODUCTS } from "@/products";
import {
  methodRoutes,
  PROBED_METHODS,
  probedSoftens,
  servedCollections,
  staleResolvedElsewhere,
  type MethodRoute,
} from "./api-paths";
import { CLIENT_LOCAL } from "./demo-only";
import { routeRequirements, type RouteRequirement } from "./route-snapshots";
import { scanScreens, type ClientCall, type Screen } from "./scan";
import { normalPath } from "./source";
import { SPEC_FEATURES } from "./spec-features";
import { indexTests, type TestFile, type TestKind } from "./test-index";

/**
 * The coverage list's model (whole-product check, ADR 0058): the screen scan, the client's routing,
 * the route catalog and the test index joined into one picture, from code only. The coverage test
 * checks it (CV-1 to CV-8) and render.ts writes it out as docs/coverage.md and page-coverage.json.
 */

/** Where a call a screen makes goes in api mode. */
export type TargetState = "api" | "demo" | "client";

/**
 * A page's standing in api mode: every data call on the API, some on DemoStore (mixed), none on
 * the API or the page hidden in api mode (demo-only), or no data call at all.
 */
export type Classification = "api" | "mixed" | "demo-only" | "no data";

/** A route the client sends, by the catalog's name, and how the client softens its refusal. */
export interface TargetRoute {
  route: string;
  softens: MethodRoute["softens"];
}

/** A page or layout in api mode. */
export interface ScreenCoverage {
  route: string;
  file: string;
  kind: Screen["kind"];
  layouts: string[];
  classification: Classification;
  /** Hidden from menus and search in api mode (`MenuItem.demoOnly`). */
  hiddenInApiMode: boolean;
  onApi: string[];
  onDemo: string[];
  routes: string[];
  features: FeatureKey[];
  calls: ClientCall[];
}

/** A route of the catalog with what reaches it. */
export interface RouteCoverage {
  route: string;
  requirement: RouteRequirement;
  screens: string[];
  tests: Record<"integration" | "apiE2e", string[]>;
}

/** A feature of the register with its spec, pages and routes. */
export interface FeatureCoverage {
  key: FeatureKey;
  spec: string | null;
  pages: string[];
  routes: string[];
  tests: Record<TestKind, string[]>;
}

/** Everything the coverage list knows, plus the problems the CV tests assert are empty. */
export interface CoverageModel {
  screens: ScreenCoverage[];
  targets: Map<string, TargetState>;
  targetRoutes: Map<string, TargetRoute[]>;
  routes: RouteCoverage[];
  features: FeatureCoverage[];
  tests: TestFile[];
  /** Routes API_METHODS sends that the catalog doesn't have (CV-4). */
  unknownRoutes: string[];
  /** API_METHODS keys whose paths aren't literal and aren't in RESOLVED_ELSEWHERE (CV-4). */
  unresolved: string[];
  /** RESOLVED_ELSEWHERE entries the code no longer needs (CV-4). */
  staleElsewhere: string[];
}

/** The catalog's name for a `VERB /path` the client sends, or null when the catalog has no such route. */
function catalogNamer(catalog: Iterable<string>): (route: string) => string | null {
  const byNormal = new Map<string, string>();
  for (const name of catalog) {
    const space = name.indexOf(" ");
    byNormal.set(`${name.slice(0, space)} ${normalPath(name.slice(space + 1))}`, name);
  }
  return (route) => byNormal.get(route) ?? null;
}

/** A page route with its `*` segments filled, so feature screen patterns can be matched against it. */
export function samplePath(route: string): string {
  return route.replace(/\*/g, "x");
}

/**
 * The features owning a page, any view of it (a page serves all its views): a feature screen
 * pattern matches with its own view, as `pagePatternScore` scores page rules and feature screens.
 */
export function featuresOfPage(route: string): FeatureKey[] {
  const path = samplePath(route);
  return FEATURE_KEYS.filter((key) =>
    FEATURES[key].screens.some((screen) => {
      const view = new URLSearchParams(screen.split("?")[1] ?? "").get("view");
      return pagePatternScore(screen, path, view) > 0;
    }),
  );
}

/** Where each call target goes in api mode, from API_METHODS, the served-collection probe and CLIENT_LOCAL. */
function stateOf(
  target: string,
  served: { list: Map<string, string>; get: Map<string, string> },
  onApi: Set<string>,
): TargetState {
  if (target in CLIENT_LOCAL) return "client";
  const [method = "", collection] = target.split(":");
  if (method === "list" || method === "get") return served[method].has(collection ?? "") ? "api" : "demo";
  if (collection !== undefined) return "demo";
  return onApi.has(method) ? "api" : "demo";
}

/** The pages hidden in api mode: menu items marked `demoOnly`. */
function hiddenPages(): Set<string> {
  const items = Object.values(PRODUCTS).flatMap((product) => [...product.menu, ...product.settings]);
  return new Set(items.filter((item) => item.demoOnly).map((item) => item.href));
}

/** Classifies a screen from where its data calls go. */
function classify(onApi: readonly string[], onDemo: readonly string[], hidden: boolean): Classification {
  if (hidden) return "demo-only";
  if (onApi.length === 0 && onDemo.length === 0) return "no data";
  if (onApi.length === 0) return "demo-only";
  return onDemo.length === 0 ? "api" : "mixed";
}

/** The spec a feature sits under in SPEC_FEATURES (or SHELL_GROUP), or null when none lists it. */
function specOf(key: FeatureKey): string | null {
  return Object.entries(SPEC_FEATURES).find(([, keys]) => keys.includes(key))?.[0] ?? null;
}

/** Builds the coverage model from the code as it is. */
export async function buildCoverage(): Promise<CoverageModel> {
  const requirements = routeRequirements();
  const nameOf = catalogNamer(requirements.keys());
  const scanned = scanScreens();
  const served = await servedCollections();
  const { routes: byMethod, unresolved } = methodRoutes();
  const onApiMethods = new Set([...byMethod.keys(), ...PROBED_METHODS]);

  const targets = new Map<string, TargetState>();
  const targetRoutes = new Map<string, TargetRoute[]>();
  const unknownRoutes = new Set<string>();
  const named = (route: string, softens: MethodRoute["softens"]): TargetRoute[] => {
    const name = nameOf(route);
    if (!name) unknownRoutes.add(route);
    return name ? [{ route: name, softens }] : [];
  };
  for (const [method, routes] of byMethod) {
    targetRoutes.set(
      method,
      routes.flatMap((r) => named(r.route, r.softens)),
    );
  }
  for (const method of ["list", "get"] as const) {
    for (const [collection, route] of served[method]) {
      targetRoutes.set(`${method}:${collection}`, named(route, probedSoftens(method)));
    }
  }
  for (const call of scanned.flatMap((screen) => screen.calls)) {
    targets.set(call.target, stateOf(call.target, served, onApiMethods));
  }

  const hidden = hiddenPages();
  const screens = scanned.map((screen): ScreenCoverage => {
    const distinct = [...new Set(screen.calls.map((call) => call.target))].sort();
    const onApi = distinct.filter((target) => targets.get(target) === "api");
    const onDemo = distinct.filter((target) => targets.get(target) === "demo");
    const isHidden = screen.kind === "page" && hidden.has(screen.route);
    const routes = [...new Set(onApi.flatMap((target) => (targetRoutes.get(target) ?? []).map((r) => r.route)))];
    return {
      route: screen.route,
      file: screen.file,
      kind: screen.kind,
      layouts: screen.layouts,
      classification: classify(onApi, onDemo, isHidden),
      hiddenInApiMode: isHidden,
      onApi,
      onDemo,
      routes: routes.sort(),
      features: screen.kind === "page" ? featuresOfPage(screen.route) : [],
      calls: screen.calls,
    };
  });

  const pages = screens.filter((screen) => screen.kind === "page");
  const tests = indexTests(
    pages.map((page) => page.route),
    [...requirements.keys()],
  );
  const testsOf = (kind: TestKind, touches: (test: TestFile) => boolean) =>
    tests.filter((test) => test.kind === kind && touches(test)).map((test) => test.file);

  const routes = [...requirements].map(([route, requirement]): RouteCoverage => ({
    route,
    requirement,
    screens: screens.filter((screen) => screen.routes.includes(route)).map((screen) => screen.route),
    tests: {
      integration: testsOf("integration", (test) => test.routes.includes(route)),
      apiE2e: testsOf("apiE2e", (test) => test.routes.includes(route)),
    },
  }));

  const features = FEATURE_KEYS.map((key): FeatureCoverage => {
    const featurePages = pages.filter((page) => page.features.includes(key)).map((page) => page.route);
    const featureRoutes = routes.filter((route) => key in (route.requirement.features ?? {})).map((r) => r.route);
    const touchesPage = (test: TestFile) => test.pages.some((page) => featurePages.includes(page));
    const touchesRoute = (test: TestFile) => test.routes.some((route) => featureRoutes.includes(route));
    return {
      key,
      spec: specOf(key),
      pages: featurePages,
      routes: featureRoutes,
      tests: {
        unit: testsOf("unit", (test) => test.features.includes(key) || touchesPage(test)),
        integration: testsOf("integration", touchesRoute),
        demoE2e: testsOf("demoE2e", touchesPage),
        apiE2e: testsOf("apiE2e", (test) => touchesPage(test) || touchesRoute(test)),
      },
    };
  });

  return {
    screens,
    targets: new Map([...targets].sort(([a], [b]) => a.localeCompare(b))),
    targetRoutes,
    routes,
    features,
    tests,
    unknownRoutes: [...unknownRoutes].sort(),
    unresolved,
    staleElsewhere: staleResolvedElsewhere((route) => nameOf(route) !== null),
  };
}
