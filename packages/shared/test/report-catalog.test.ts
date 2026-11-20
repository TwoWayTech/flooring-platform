import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  EMPTY_REPORT_OPTIONS,
  PRODUCT_MODULES,
  PRODUCT_ROLES,
  REPORT_CATALOG,
  REPORT_ORDER,
  featureOn,
  reportAccess,
  resolveAccess,
  roleTemplate,
  type DataScope,
  type DefaultRoleKey,
  type FeatureKey,
  type ReportKey,
} from "../src";

const accessOf = (key: DefaultRoleKey) =>
  resolveAccess([{ id: key, ...roleTemplate(key) }], ALL_PERMISSION_KEYS, PRODUCT_MODULES.flooring);
const without =
  (...off: FeatureKey[]) =>
  (key: FeatureKey) =>
    !off.includes(key) && featureOn(key);
const REMOVED = ["tax", "inventory", "aging", "payables"];

describe("who opens and exports which report (ADR 0055 S1, S-ACC-1)", () => {
  it.each<[DefaultRoleKey, ReportKey[], ReportKey[]]>([
    ["owner", ["business", "pnl", "sales", "payments"], ["business", "pnl", "sales", "payments"]],
    ["accountant", ["business", "pnl", "sales", "payments"], ["business", "pnl", "sales", "payments"]],
    ["manager", ["sales", "payments"], ["sales"]],
    ["sales", ["sales"], []],
    ["purchasing", [], []],
    ["warehouse", [], []],
    ["hr", [], []],
    ["installer", [], []],
    ["employee", [], []],
  ])("%s", (key, reports, exports) => {
    expect(reportAccess(accessOf(key))).toEqual({ reports, exports });
  });

  it("never gives a company-wide report to branch or own scope, whatever the keys", () => {
    const owner = accessOf("owner");
    for (const dataScope of ["branch", "own"] as DataScope[]) {
      const access = reportAccess({ ...owner, dataScope });
      expect(access.reports).toEqual(["sales", "payments"]);
      expect(access.exports).toEqual(["sales", "payments"]);
    }
    for (const key of REPORT_ORDER)
      expect(REPORT_CATALOG[key].wholeCompany).toBe(["business", "pnl", "trial-balance"].includes(key));
  });

  it("follows the switches: a report's own, and the hub for all of them", () => {
    const owner = accessOf("owner");
    expect(reportAccess(owner, without("reports.business")).reports).toEqual(["pnl", "sales", "payments"]);
    expect(reportAccess(owner, without("reports.payments")).exports).toEqual(["business", "pnl", "sales"]);
    expect(reportAccess(owner, without("reports.hub"))).toEqual({ reports: [], exports: [] });
  });

  it("exports only what can be opened, and never a removed report", () => {
    for (const key of PRODUCT_ROLES.flooring) {
      for (const dataScope of ["all", "branch", "own"] as DataScope[]) {
        const access = reportAccess({ ...accessOf(key), dataScope });
        for (const k of access.exports) expect(access.reports).toContain(k);
        for (const k of access.reports) expect(REMOVED).not.toContain(k);
      }
    }
  });

  it("offers the trial balance only when the caller says the books may be shown (ADR 0055 Trial balance)", () => {
    const all: ReportKey[] = ["business", "pnl", "sales", "payments", "trial-balance"];
    expect(reportAccess(accessOf("owner"), featureOn, true)).toEqual({ reports: all, exports: all });
    expect(reportAccess(accessOf("accountant"), featureOn, true)).toEqual({ reports: all, exports: all });
    // Branch scope and missing keys win over `books`.
    expect(reportAccess(accessOf("manager"), featureOn, true).reports).toEqual(["sales", "payments"]);
    expect(reportAccess({ ...accessOf("owner"), dataScope: "branch" }, featureOn, true).reports).not.toContain(
      "trial-balance",
    );
    expect(reportAccess(accessOf("sales"), featureOn, true)).toEqual({ reports: ["sales"], exports: [] });
    // It rides on the hub's switch.
    expect(REPORT_CATALOG["trial-balance"].feature).toBe("reports.hub");
    expect(reportAccess(accessOf("owner"), without("reports.hub"), true)).toEqual({ reports: [], exports: [] });
    expect(reportAccess(accessOf("owner"), without("reports.business"), true).reports).toContain("trial-balance");
    for (const key of REPORT_ORDER) expect(REPORT_CATALOG[key].books).toBe(key === "trial-balance");
  });

  it("offers nothing to a person with no report", () => {
    expect(EMPTY_REPORT_OPTIONS).toEqual({ reports: [], exports: [], locations: [], salespeople: [], vendors: [] });
  });
});
