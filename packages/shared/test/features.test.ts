import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  FEATURE_KEYS,
  FEATURES,
  featureForPath,
  featureOn,
  pathOn,
  type FeatureKey,
  type FeatureRegister,
} from "../src";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The code-formatted values in a table cell, such as `/meetings` or `users.spec.ts`. */
const ticked = (cell = "") => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** The rows of the register table in docs/FEATURES.md. */
function documentedFeatures() {
  const text = readFileSync(`${ROOT}docs/FEATURES.md`, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const cells = line
        .replace(/^\|\s*/, "")
        .replace(/\s*\|\s*$/, "")
        .split(/\s+\|\s+/);
      const [key, product, module, status, screens, permissions, data, tests] = cells;
      return {
        key: ticked(key)[0] as FeatureKey,
        product,
        module,
        status,
        screens: ticked(screens),
        permissions: ticked(permissions),
        data: ticked(data),
        tests: ticked(tests),
      };
    });
}

/** Collection names a feature can list under Data: every fixture collection, plus the platform's companies. */
function collectionNames(): Set<string> {
  const fixture = JSON.parse(readFileSync(`${ROOT}packages/shared/fixtures/summit.json`, "utf8")) as object;
  const names = Object.keys(fixture).filter((k) => k !== "companyId" && k !== "anchorDate");
  return new Set([...names, "companies"]);
}

const testExists = (file: string) =>
  existsSync(`${ROOT}apps/web/tests/e2e/${file}`) || existsSync(`${ROOT}packages/shared/test/${file}`);

/** A copy of the register with one feature switched off. */
function withOff(key: FeatureKey): FeatureRegister {
  return { ...FEATURES, [key]: { ...FEATURES[key], enabled: false } };
}

describe("feature register", () => {
  const rows = documentedFeatures();

  it("lists every switch in docs/FEATURES.md, in the same order, and nothing else", () => {
    expect(rows.map((r) => r.key)).toEqual(FEATURE_KEYS);
  });

  it("agrees with the code on product, module, status and screens", () => {
    for (const row of rows) {
      const feature = FEATURES[row.key];
      expect({ key: row.key, product: row.product, module: row.module, status: row.status }).toEqual({
        key: row.key,
        product: feature.product,
        module: feature.module,
        status: feature.status,
      });
      expect(row.screens, row.key).toEqual([...feature.screens]);
    }
  });

  it("names only real permission keys, collections and test files", () => {
    const collections = collectionNames();
    for (const row of rows) {
      for (const key of row.permissions) expect(ALL_PERMISSION_KEYS, `${row.key}: ${key}`).toContain(key);
      for (const name of row.data) expect(collections.has(name), `${row.key}: ${name}`).toBe(true);
      for (const file of row.tests) expect(testExists(file), `${row.key}: ${file}`).toBe(true);
    }
  });

  it("keeps a removed feature off whatever its switch says", () => {
    const register = { ...FEATURES, "reports.hub": { ...FEATURES["reports.hub"], status: "removed" as const } };
    expect(featureOn("reports.hub", register)).toBe(false);
    expect(featureOn("reports.hub")).toBe(true);
  });
});

describe("feature for a page", () => {
  it("finds the feature that owns a route, a view or a link", () => {
    const cases: [Parameters<typeof featureForPath>[0], string, FeatureKey | null][] = [
      ["flooring", "/", "dashboard.store"],
      ["hr", "/", "hr.dashboard"],
      ["flooring", "/hr", "hr.dashboard"],
      ["flooring", "/inventory/rolls/sm-roll-0004", "inventory.rolls"],
      ["flooring", "/inventory?view=rolls&filter=low", "inventory.rolls"],
      ["flooring", "/inventory?view=products", "inventory.products"],
      ["flooring", "/sales?view=invoices&status=overdue", "sales.invoices"],
      ["flooring", "/sales/quotes/new", "sales.quotes"],
      ["flooring", "/purchasing?view=bills", "purchasing.orders"],
      ["hr", "/hr/time-off", "hr.time-off"],
      ["hr", "/meetings", "meetings.calendar"],
      ["flooring", "/settings/roles", "settings.roles"],
      ["flooring", "/admin/companies/summit", "admin.access"],
    ];
    for (const [product, href, key] of cases) expect(featureForPath(product, href), href).toBe(key);
  });

  it("leaves pages that hold several features, or none, to their own checks", () => {
    for (const href of ["/inventory", "/sales", "/settings", "/login"]) {
      expect(featureForPath("flooring", href), href).toBeNull();
    }
  });

  it("hides a switched-off feature's pages and links, and nothing else", () => {
    const register = withOff("installation.calendar");
    expect(pathOn("flooring", "/installation", register)).toBe(false);
    expect(pathOn("flooring", "/installation?job=x", register)).toBe(false);
    expect(pathOn("flooring", "/inventory", register)).toBe(true);
    expect(pathOn("flooring", "/installation")).toBe(true);
  });
});
