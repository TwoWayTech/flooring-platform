import { readFileSync } from "node:fs";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/internal";
import {
  FEATURES,
  isPermissionKey,
  permissionDef,
  PRODUCT_HEADER,
  PRODUCT_MODULES,
  PRODUCT_ROLES,
  rolesRequireMfa,
  type DefaultRoleKey,
  type FeatureKey,
  type ModuleKey,
  type ProductKey,
} from "@workspace/shared";
import request from "supertest";
import type { Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERMISSION_REFUSALS, PermissionGuard } from "../src/core/access/permission.guard";
import type { AuthSession } from "../src/core/auth/session.service";
import { TENANCY_REFUSALS, TenantGuard } from "../src/core/tenancy/tenant.guard";
import { AuthHarness } from "./auth-harness";
import {
  byCodeUnit,
  concretePath,
  hasPathParameter,
  isWrite,
  routeCatalog,
  type CatalogRoute,
} from "./support/route-catalog";
import {
  CROSS_MODULE_ROUTES,
  DOCUMENT_WRITES,
  EMPTY_BODY_OK,
  NO_MODULE_ROUTES,
  NO_SWITCH_ROUTES,
  QUERY_FOR,
  SWITCH_READ_IN_SERVICE,
  TIER_B_DEFAULT,
  WRITE_WITH_VIEW_KEY,
} from "./support/route-lists";
import { expectedOutcome, type GuardOutcome } from "./support/route-oracle";
import { listRoutes } from "./support/routes";
import { enrolled } from "./support/sign-in";
import { withFeaturesOff, withModuleOff } from "./support/switches";

/** The feature keys `featureOn` is asked about while `current` is set (PM-5's trace). */
const featureTrace = vi.hoisted(() => ({ current: null as Set<string> | null }));

// Wraps `featureOn` so PM-5 can see which switches a request reads. Every other export, and the
// FEATURES object itself, stay the real ones, so flipping FEATURES[key].enabled still applies.
vi.mock("@workspace/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...actual,
    featureOn(key: Parameters<typeof actual.featureOn>[0], register?: Parameters<typeof actual.featureOn>[1]) {
      featureTrace.current?.add(key);
      return actual.featureOn(key, register);
    },
  };
});

/** Long variants (tier C) run only with WHOLE_CHECK=1; tier B runs by default unless the CI gate turns it off. */
const WHOLE_CHECK = process.env.WHOLE_CHECK === "1";
const TIER_B = WHOLE_CHECK || TIER_B_DEFAULT;

/** The id every path parameter gets: a valid UUID that names no record. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const SNAPSHOTS = "./__snapshots__";
const REQUIREMENTS_FILE = `${SNAPSHOTS}/route-requirements.json`;
const SNAPSHOT_NOTE = "guard decisions only; see docs/whole-product-check.md for in-handler rules";

/** A company of the matrix and the people in it, one per default role of its product. */
interface MatrixCompany {
  id: string;
  product: ProductKey;
  people: Map<DefaultRoleKey, { email: string; userId: string }>;
}

/**
 * What a switch does to a route when it is off: hides it (the bare 404) on its own, hides it only
 * with the other switches marked the same (any one of them on lets the route through), or only
 * changes the answer.
 */
type SwitchEffect = "gating" | "any-of" | "shaping";

/** A refusal the guards themselves send, with their exact words. */
function guardMessage(code: string): string | undefined {
  if (code in PERMISSION_REFUSALS) return PERMISSION_REFUSALS[code as keyof typeof PERMISSION_REFUSALS];
  if (code in TENANCY_REFUSALS) return TENANCY_REFUSALS[code as keyof typeof TENANCY_REFUSALS];
  return undefined;
}

/** Whether an HTTP answer is one of the guards' refusals (a service's own 403 has other words). */
function isGuardRefusal(response: Response): boolean {
  const body = response.body as { code?: string; message?: string };
  if (response.status !== 403 || body.code === undefined) return false;
  if (body.code === "mfa_enrolment_required") return true;
  const message = guardMessage(body.code);
  return message !== undefined && message === body.message;
}

/** Runs `run` over `items`, `size` at a time. */
async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(run));
  }
}

/** Reviewed entries that name no route of the catalog, or a route the rule no longer needs them for. */
function staleEntries(list: Readonly<Record<string, unknown>>, needed: ReadonlySet<string>): string[] {
  return Object.keys(list).filter((name) => !needed.has(name));
}

/**
 * The permission matrix (whole-product check, piece 3; CLAUDE.md rules 3 to 5 and 13): every company
 * route against every default role of both products, decided by the real TenantGuard and
 * PermissionGuard and compared with an oracle built only from packages/shared, then checked over
 * HTTP, with modules and feature switches turned off. Every outcome here is a guard decision; rules
 * inside handlers (data scope, Owner-only, separation of duties) are listed in the report.
 */
describe("route matrix: the guard chain against the shared engine (whole-product check, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const companies = new Map<ProductKey, MatrixCompany>();
  /** Each company route's switches and what they do, filled by PM-5. */
  const switchEffects = new Map<string, Record<string, SwitchEffect>>();
  let featuresTraced = false;
  let catalog: CatalogRoute[] = [];
  let companyRoutes: CatalogRoute[] = [];

  beforeAll(async () => {
    await harness.start([DiscoveryModule]);
    for (const product of ["flooring", "hr"] as const) {
      const { id } = await harness.provisionCompany(product === "flooring" ? "matrixfl" : "matrixhr", [product]);
      const people = new Map<DefaultRoleKey, { email: string; userId: string }>();
      for (const role of PRODUCT_ROLES[product]) {
        const email = await harness.addUser({ companyIds: [id], roles: [role] });
        people.set(role, { email, userId: await harness.userIdOf(email) });
      }
      companies.set(product, { id, product, people });
    }
    catalog = routeCatalog(harness.app);
    companyRoutes = catalog.filter((route) => route.level === "company");
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  });

  function company(product: ProductKey): MatrixCompany {
    const found = companies.get(product);
    if (!found) throw new Error(`No ${product} company in the matrix.`);
    return found;
  }

  /** A request as the web app's proxy sends it from the product's host; writes carry an empty body. */
  function send(route: CatalogRoute, cookie: string, product: ProductKey, query?: string) {
    const url = `${concretePath(route, NIL_UUID)}${query ? `?${query}` : ""}`;
    const pending = request(harness.app.getHttpServer())
      [route.verb](url)
      .set("X-Forwarded-Host", "localhost:3000")
      .set(PRODUCT_HEADER, product)
      .set("Cookie", cookie);
    return isWrite(route) ? pending.send({}) : pending;
  }

  const cookies = new Map<string, string>();

  /**
   * A session cookie for one person of a matrix company, signed in once and reused; roles that need
   * MFA enrol an authenticator first (an authenticator is enrolled only once per person).
   */
  async function cookieFor(product: ProductKey, role: DefaultRoleKey): Promise<string> {
    const person = company(product).people.get(role);
    if (!person) throw new Error(`No ${role} in the ${product} company.`);
    const known = cookies.get(person.email);
    if (known) return known;
    const cookie = rolesRequireMfa([role])
      ? (await enrolled(harness, person.email)).cookie
      : await harness.signIn(person.email);
    cookies.set(person.email, cookie);
    return cookie;
  }

  /**
   * The real chain on one ExecutionContextHost, as Nest runs it: TenantGuard sets the tenant from the
   * verified session, then PermissionGuard decides. MFA is held, as for an enrolled person.
   */
  async function guardChain(route: CatalogRoute, product: ProductKey, role: DefaultRoleKey, host: ProductKey) {
    const { id, people } = company(product);
    const person = people.get(role);
    if (!person) throw new Error(`No ${role} in the ${product} company.`);
    const authSession: AuthSession = {
      user: { id: person.userId, name: "Matrix", email: person.email },
      sessionId: "route-matrix",
      sessionCreatedAt: new Date(),
      companyId: id,
      mfa: { required: rolesRequireMfa([role]), totp: true, passkeys: 0, state: "ok" },
    };
    const httpRequest = { method: route.method, headers: { [PRODUCT_HEADER]: host }, authSession };
    const context = new ExecutionContextHost([httpRequest, {}, () => undefined], route.controller, route.handler);
    try {
      await harness.app.get(TenantGuard).canActivate(context);
      await harness.app.get(PermissionGuard).canActivate(context);
      return "pass";
    } catch (error) {
      if (error instanceof ForbiddenException) return (error.getResponse() as { code: string }).code;
      throw error;
    }
  }

  describe("PM-1: the catalog and its static rules", () => {
    it("(a) lists every Nest route Express serves, read through the guards' own readers", () => {
      const served = listRoutes(harness.app.getHttpAdapter().getInstance())
        .filter((route) => !route.path.startsWith("/docs") && !route.path.startsWith("/api/auth/"))
        .map((route) => `${route.method} ${route.path}`)
        .sort(byCodeUnit);
      expect(catalog.map((route) => route.name)).toEqual(served);
      expect(companyRoutes.length).toBeGreaterThan(0);
    }, 30_000);

    it("(b) gives every company route a module, unless it is any-member or reviewed with platform keys only", () => {
      const needed = new Set<string>();
      const problems: string[] = [];
      for (const route of companyRoutes) {
        if (route.module !== undefined || route.anyMember) continue;
        needed.add(route.name);
        if (!(route.name in NO_MODULE_ROUTES)) problems.push(`${route.name}: no module and not reviewed`);
        const outside = route.anyOf.filter((key) => permissionDef(key)?.module !== "platform");
        if (outside.length > 0)
          problems.push(`${route.name}: no module, but keys outside platform: ${outside.join(", ")}`);
      }
      expect(problems).toEqual([]);
      expect(staleEntries(NO_MODULE_ROUTES, needed)).toEqual([]);
    }, 30_000);

    it("(c) declares only keys of the shared catalog", () => {
      const unknown = catalog.flatMap((route) =>
        route.anyOf.filter((key) => !isPermissionKey(key)).map((key) => `${route.name}: ${key}`),
      );
      expect(unknown).toEqual([]);
    }, 30_000);

    it("(d) declares keys of its own module, core or platform, unless reviewed as cross-module", () => {
      const crossing = new Set<string>();
      for (const route of companyRoutes) {
        const own = new Set<ModuleKey | undefined>([route.module, "core", "platform"]);
        if (route.anyOf.some((key) => !own.has(permissionDef(key)?.module))) crossing.add(route.name);
      }
      expect([...crossing].filter((name) => !(name in CROSS_MODULE_ROUTES))).toEqual([]);
      expect(staleEntries(CROSS_MODULE_ROUTES, crossing)).toEqual([]);
    }, 30_000);

    it("(e) lets no write through on a view key or membership alone, unless reviewed", () => {
      const viewOnly = new Set(
        companyRoutes
          .filter(isWrite)
          .filter((route) => route.anyOf.length === 0 || route.anyOf.some((key) => key.endsWith(".view")))
          .map((route) => route.name),
      );
      expect([...viewOnly].filter((name) => !(name in WRITE_WITH_VIEW_KEY))).toEqual([]);
      expect(staleEntries(WRITE_WITH_VIEW_KEY, viewOnly)).toEqual([]);
    }, 30_000);

    it("(f) classifies every write on an existing record, and every PUT, PATCH and DELETE (SH-10)", () => {
      const onRecords = new Set(
        companyRoutes
          .filter((route) => isWrite(route) && (hasPathParameter(route) || route.method !== "POST"))
          .map((route) => route.name),
      );
      expect([...onRecords].filter((name) => !(name in DOCUMENT_WRITES))).toEqual([]);
      expect(staleEntries(DOCUMENT_WRITES, onRecords)).toEqual([]);
    }, 30_000);
  });

  describe("PM-2: the guard chain against the oracle, every company route × every default role", () => {
    it("decides every pair as the shared engine says, and the snapshot records who gets in", async () => {
      const mismatches: string[] = [];
      const allowed = new Map<string, Map<ProductKey, DefaultRoleKey[]>>();
      const pairs = (["flooring", "hr"] as const).flatMap((product) =>
        PRODUCT_ROLES[product].flatMap((role) => companyRoutes.map((route) => ({ product, role, route }))),
      );
      await inBatches(pairs, 8, async ({ product, role, route }) => {
        const expected = expectedOutcome(route, role, { products: [product], host: product });
        const actual = await guardChain(route, product, role, product);
        if (actual !== expected)
          mismatches.push(`${product} ${role} ${route.name}: guards ${actual}, oracle ${expected}`);
        if (actual !== "pass") return;
        const byProduct = allowed.get(route.name) ?? new Map<ProductKey, DefaultRoleKey[]>();
        byProduct.set(product, [...(byProduct.get(product) ?? []), role]);
        allowed.set(route.name, byProduct);
      });
      expect(mismatches.sort(byCodeUnit)).toEqual([]);
      const column = (name: string, product: ProductKey) => {
        const roles = allowed.get(name)?.get(product) ?? [];
        const ordered = PRODUCT_ROLES[product].filter((role) => roles.includes(role));
        return `${product}: ${ordered.length > 0 ? ordered.join(" ") : "-"}`;
      };
      const lines = companyRoutes.map(
        (route) => `${route.name}  ${column(route.name, "flooring")}  ${column(route.name, "hr")}`,
      );
      const header = [
        `# ${SNAPSHOT_NOTE}.`,
        "# Who gets past TenantGuard and PermissionGuard in a fresh trial of each product, MFA held.",
      ];
      await expect([...header, ...lines, ""].join("\n")).toMatchFileSnapshot(`${SNAPSHOTS}/route-role-matrix.txt`);
    }, 180_000);

    it("refuses an HR Suite company on the Flooring Suite host, on every company route", async () => {
      const wrongHost: string[] = [];
      await inBatches(companyRoutes, 8, async (route) => {
        const outcome = await guardChain(route, "hr", "owner", "flooring");
        if (outcome !== "product_not_enabled") wrongHost.push(`${route.name}: ${outcome}`);
      });
      expect(wrongHost.sort(byCodeUnit)).toEqual([]);
    }, 60_000);
  });

  describe.runIf(TIER_B)("PM-3: HTTP agrees with the guards", () => {
    /** Lite by default (the Employee of each product); every role with WHOLE_CHECK=1. */
    const rolesOf = (product: ProductKey): readonly DefaultRoleKey[] =>
      WHOLE_CHECK ? PRODUCT_ROLES[product] : ["employee"];

    it(
      "answers each company route with the oracle's refusal and words, and never 5xx or 2xx to {} where it passes",
      async () => {
        const problems: string[] = [];
        for (const product of ["flooring", "hr"] as const) {
          for (const role of rolesOf(product)) {
            const cookie = await cookieFor(product, role);
            for (const route of companyRoutes) {
              const expected: GuardOutcome = expectedOutcome(route, role, { products: [product], host: product });
              const response = await send(route, cookie, product);
              const body = response.body as { code?: string; message?: string };
              const where = `${product} ${role} ${route.name}`;
              if (expected !== "pass") {
                if (response.status !== 403 || body.code !== expected || body.message !== guardMessage(expected)) {
                  problems.push(`${where}: expected 403 ${expected}, got ${response.status} ${body.code}`);
                }
              } else if (response.status >= 500) {
                problems.push(`${where}: ${response.status} ${body.code}`);
              } else if (isGuardRefusal(response)) {
                problems.push(`${where}: refused by a guard (${body.code}) where the oracle passes`);
              } else if (isWrite(route) && response.status < 300 && !(route.name in EMPTY_BODY_OK)) {
                problems.push(`${where}: ${response.status} to an empty body`);
              }
            }
          }
        }
        expect(problems).toEqual([]);
      },
      WHOLE_CHECK ? 600_000 : 120_000,
    );
  });

  describe("PM-4: module and product switches", () => {
    it("has no route for retail, wholesale or installation (finding F-e)", () => {
      const declared = new Set(companyRoutes.map((route) => route.module));
      expect((["retail", "wholesale", "installation"] as const).filter((module) => declared.has(module))).toEqual([]);
    });

    it("declares, on some route, every business module whose keys the routes ask for, so it can be switched off", () => {
      const declared = new Set(companyRoutes.map((route) => route.module));
      const asked = new Set(companyRoutes.flatMap((route) => route.anyOf.map((key) => permissionDef(key)?.module)));
      const undeclared = [...asked].filter((module) => module !== "platform" && !declared.has(module));
      expect(undeclared).toEqual([]);
    });

    it("refuses every route that declares a module once it is off, and leaves the no-module routes alone", async () => {
      const flooring = company("flooring");
      const cookie = await cookieFor("flooring", "owner");
      const modules = [...new Set(companyRoutes.map((route) => route.module))].filter(
        (module): module is ModuleKey => module !== undefined && module !== "platform",
      );
      expect(modules.length).toBeGreaterThan(0);
      const controls = companyRoutes.filter((route) => route.name in NO_MODULE_ROUTES && !isWrite(route));
      expect(controls.length).toBeGreaterThan(0);
      const problems: string[] = [];
      for (const module of modules) {
        await withModuleOff(harness, flooring.id, module, async () => {
          for (const route of companyRoutes.filter((candidate) => candidate.module === module)) {
            const response = await send(route, cookie, "flooring");
            const body = response.body as { code?: string; message?: string };
            if (response.status !== 403 || body.code !== "module_not_enabled") {
              problems.push(`${module} off, ${route.name}: ${response.status} ${body.code}`);
            }
          }
          for (const route of controls) {
            const response = await send(route, cookie, "flooring");
            if (response.status >= 500 || isGuardRefusal(response)) {
              problems.push(`${module} off, control ${route.name}: ${response.status}`);
            }
          }
        });
      }
      expect(problems).toEqual([]);
    }, 120_000);

    it("refuses Flooring Suite modules and flooring-only routes to an HR Suite company", async () => {
      const cookie = await cookieFor("hr", "employee");
      const problems: string[] = [];
      const outside = companyRoutes.filter(
        (route) =>
          route.product === "flooring" || (route.module !== undefined && !PRODUCT_MODULES.hr.includes(route.module)),
      );
      expect(outside.length).toBeGreaterThan(0);
      for (const route of outside) {
        const expected = route.product === "flooring" ? "product_not_enabled" : "module_not_enabled";
        const response = await send(route, cookie, "hr");
        const body = response.body as { code?: string };
        if (response.status !== 403 || body.code !== expected) {
          problems.push(`${route.name}: expected ${expected}, got ${response.status} ${body.code}`);
        }
      }
      expect(problems).toEqual([]);
    }, 120_000);
  });

  describe.runIf(TIER_B)("PM-5: feature switches, traced then flipped", () => {
    /** The bare 404 a switched-off feature answers (`requireFeature`), as the error filter sends it. */
    const SWITCHED_OFF = JSON.stringify({ status: 404, code: "not_found", message: new NotFoundException().message });

    /** The parts of an answer PM-5 compares, as one string. */
    function answerOf(response: Response): string {
      const body = response.body as { code?: string; message?: string };
      return JSON.stringify({ status: response.status, code: body.code, message: body.message });
    }

    /** Whether a switch hid the route: the switched-off 404, where every switch on answered something else. */
    const hides = (off: string, first: string) => off === SWITCHED_OFF && first !== SWITCHED_OFF;

    it("finds the switch that hides each company route, and none reads a removed feature", async () => {
      const { id } = await harness.provisionCompany("matrixsw");
      const owner = await enrolled(harness, await harness.addUser({ companyIds: [id], roles: ["owner"] }));

      /** One request with these switches off, and the switches it read before it answered. */
      async function traced(route: CatalogRoute, off: readonly FeatureKey[]) {
        featureTrace.current = new Set();
        try {
          const answer = await withFeaturesOff(off, async () =>
            answerOf(await send(route, owner.cookie, "flooring", QUERY_FOR[route.name])),
          );
          return { answer, read: [...featureTrace.current].sort(byCodeUnit) as FeatureKey[] };
        } finally {
          featureTrace.current = null;
        }
      }

      /**
       * Switches that hide a route only together (`requireAnyFeature`: any one on lets it through).
       * Turns off what was read, then whatever the next answer reads too, until the route is hidden.
       */
      async function hiddenTogether(route: CatalogRoute, read: readonly FeatureKey[], first: string) {
        const off = new Set(read);
        while (off.size > 0) {
          const next = await traced(route, [...off]);
          if (hides(next.answer, first)) return [...off].sort(byCodeUnit);
          const fresh = next.read.filter((key) => !off.has(key));
          if (fresh.length === 0) return [];
          for (const key of fresh) off.add(key);
        }
        return [];
      }

      const problems: string[] = [];
      for (const route of companyRoutes) {
        const { answer: first, read } = await traced(route, []);
        const status = (JSON.parse(first) as { status: number }).status;
        if (status >= 500) problems.push(`${route.name}: ${status} with every switch on`);
        if (isWrite(route) && status < 300 && !(route.name in EMPTY_BODY_OK)) {
          problems.push(`${route.name}: ${status} to an empty body`);
        }
        const effects: Record<string, SwitchEffect> = {};
        for (const key of read) {
          if (FEATURES[key].status === "removed") problems.push(`${route.name}: reads removed feature ${key}`);
          effects[key] = hides((await traced(route, [key])).answer, first) ? "gating" : "shaping";
        }
        if (!Object.values(effects).includes("gating")) {
          for (const key of await hiddenTogether(route, read, first)) effects[key] = "any-of";
        }
        switchEffects.set(route.name, effects);
      }
      featuresTraced = true;
      const ungated = new Set(
        companyRoutes
          .filter((route) => !Object.values(switchEffects.get(route.name) ?? {}).some((effect) => effect !== "shaping"))
          .map((route) => route.name),
      );
      const reviewed = { ...NO_SWITCH_ROUTES, ...SWITCH_READ_IN_SERVICE };
      problems.push(...[...ungated].filter((name) => !(name in reviewed)).map((name) => `${name}: no switch hides it`));
      problems.push(...staleEntries(reviewed, ungated).map((name) => `${name}: reviewed, but a switch hides it`));
      expect(problems).toEqual([]);
    }, 180_000);
  });

  describe("PM-1 (g): the route-requirements snapshot", () => {
    /** One route's declarations, as the snapshot records them (null where nothing is declared). */
    function requirementsOf(route: CatalogRoute) {
      return {
        level: route.level,
        product: route.product ?? null,
        module: route.module ?? null,
        anyOf: [...route.anyOf],
        anyMember: route.anyMember,
        audited: route.audited,
        sensitiveKeys: route.sensitiveKeys ?? null,
        features: route.level === "company" ? (switchEffects.get(route.name) ?? null) : null,
      };
    }

    it("records what every route declares, and the switches PM-5 found", async () => {
      const routes = Object.fromEntries(catalog.map((route) => [route.name, requirementsOf(route)]));
      const text = `${JSON.stringify({ note: SNAPSHOT_NOTE, routes }, null, 2)}\n`;
      if (featuresTraced) {
        await expect(text).toMatchFileSnapshot(REQUIREMENTS_FILE);
        return;
      }
      // Tier B is off, so PM-5 did not trace the switches: compare everything else with the file.
      const saved = JSON.parse(readFileSync(new URL(REQUIREMENTS_FILE, import.meta.url), "utf8")) as {
        routes: Record<string, { features: unknown }>;
      };
      const withoutFeatures = (all: Record<string, { features: unknown }>) =>
        Object.fromEntries(Object.entries(all).map(([name, entry]) => [name, { ...entry, features: undefined }]));
      expect(withoutFeatures(routes)).toEqual(withoutFeatures(saved.routes));
    }, 30_000);
  });
});
