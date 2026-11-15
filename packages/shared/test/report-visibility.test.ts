import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  PRODUCT_MODULES,
  reportVisibility,
  resolveAccess,
  roleTemplate,
  type DefaultRoleKey,
  type ModuleKey,
  type PermissionKey,
  type ReportVisibility,
} from "../src";

const accessOf = (key: DefaultRoleKey, modules: readonly ModuleKey[] = PRODUCT_MODULES.flooring) =>
  resolveAccess([{ id: key, ...roleTemplate(key) }], ALL_PERMISSION_KEYS, modules);
const holding = (...keys: PermissionKey[]) => ({ permissions: new Set<PermissionKey>(keys) });
const none: ReportVisibility = { margin: false, payroll: false, people: false, stock: false };
const withContracts = { hasContractInvoices: true };
const noContracts = { hasContractInvoices: false };

describe("report visibility for the default roles (ADR 0055, S-VIS-1)", () => {
  it.each<[DefaultRoleKey, ReportVisibility]>([
    ["owner", { margin: true, payroll: true, people: true, stock: true }],
    ["accountant", { margin: true, payroll: true, people: false, stock: true }],
    ["manager", { margin: true, payroll: false, people: false, stock: true }],
    ["sales", none],
    ["purchasing", { ...none, stock: true }],
    ["warehouse", none],
    ["hr", { ...none, payroll: true, people: true }],
    ["installer", none],
    ["employee", none],
  ])("%s, with contract invoices in the company", (key, expected) => {
    expect(reportVisibility(accessOf(key), withContracts)).toEqual(expected);
  });
});

describe("cost of goods needs every cost key it would reveal (S4, S17, S-VIS-2)", () => {
  it("needs the contract cost key only while a live invoice has a contract", () => {
    const viewer = holding("sales.margin.view_sensitive", "inventory.product.view_sensitive");
    expect(reportVisibility(viewer, withContracts).margin).toBe(false);
    expect(reportVisibility(viewer, noContracts).margin).toBe(true);
  });

  it("needs the product cost key, whatever the contracts", () => {
    const viewer = holding("sales.margin.view_sensitive", "contracts.contract.view_sensitive");
    expect(reportVisibility(viewer, withContracts).margin).toBe(false);
    expect(reportVisibility(viewer, noContracts).margin).toBe(false);
    expect(reportVisibility(viewer, noContracts).stock).toBe(false);
  });

  it("needs the margin key itself", () => {
    const viewer = holding("inventory.product.view_sensitive", "contracts.contract.view_sensitive");
    expect(reportVisibility(viewer, noContracts)).toEqual({ ...none, stock: true });
  });
});

describe("pay sight and switched-off modules (S3, S4, S-VIS-3)", () => {
  it("never shows people costs without pay sight", () => {
    for (const keys of [
      ["hr.employee.view_sensitive"],
      ["hr.payroll.view"],
      ["hr.payroll.view", "hr.employee.view_sensitive"],
    ] as PermissionKey[][]) {
      const show = reportVisibility(holding(...keys), noContracts);
      if (show.people) expect(show.payroll).toBe(true);
    }
    expect(reportVisibility(holding("hr.employee.view_sensitive"), noContracts)).toEqual(none);
    expect(reportVisibility(holding("hr.payroll.view"), noContracts)).toEqual({ ...none, payroll: true });
  });

  it("takes pay sight from an Owner whose company has HR switched off", () => {
    const owner = accessOf(
      "owner",
      PRODUCT_MODULES.flooring.filter((m) => m !== "hr"),
    );
    const show = reportVisibility(owner, withContracts);
    expect(show.payroll).toBe(false);
    expect(show.people).toBe(false);
    expect(show.margin).toBe(true);
  });

  it("takes cost of goods from an Owner whose company has Contracts off while contract invoices exist", () => {
    const owner = accessOf(
      "owner",
      PRODUCT_MODULES.flooring.filter((m) => m !== "contracts"),
    );
    expect(reportVisibility(owner, withContracts).margin).toBe(false);
    expect(reportVisibility(owner, noContracts).margin).toBe(true);
    expect(reportVisibility(owner, withContracts).stock).toBe(true);
  });
});
