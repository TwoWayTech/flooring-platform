import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ACCOUNTS,
  CONTRACT_SOURCE_TYPES,
  PAY_ACCOUNT_KEYS,
  PAY_SOURCE_TYPES,
  SOURCE_SIGHT,
  PRODUCT_MODULES,
  resolveAccess,
  roleTemplate,
  seesTrialBalance,
  type DefaultRoleKey,
  type PermissionKey,
  type TrialBalanceFacts,
} from "../src";

const accessOf = (key: DefaultRoleKey) =>
  resolveAccess([{ id: key, ...roleTemplate(key) }], ALL_PERMISSION_KEYS, PRODUCT_MODULES.flooring);
const holding = (...keys: PermissionKey[]) => ({ permissions: new Set<PermissionKey>(keys) });

const EMPTY: TrialBalanceFacts = { hasContractPostings: false, hasPayPostings: false };
const BUSY: TrialBalanceFacts = { hasContractPostings: true, hasPayPostings: true };
const COST: PermissionKey[] = ["sales.margin.view_sensitive", "inventory.product.view_sensitive"];

describe("who may read the trial balance (ADR 0055 Trial balance, owner question 7)", () => {
  it("lets the Owner and the Accountant read the busiest books", () => {
    expect(seesTrialBalance(accessOf("owner"), BUSY)).toBe(true);
    expect(seesTrialBalance(accessOf("accountant"), BUSY)).toBe(true);
  });

  it("always needs the margin rule: sales margin and product cost (S17)", () => {
    expect(seesTrialBalance(holding("reports.financial.view"), EMPTY)).toBe(false);
    expect(seesTrialBalance(holding("sales.margin.view_sensitive"), EMPTY)).toBe(false);
    expect(seesTrialBalance(holding("inventory.product.view_sensitive"), EMPTY)).toBe(false);
    expect(seesTrialBalance(holding(...COST), EMPTY)).toBe(true);
  });

  it("needs contract cost sight once a contract has posted (S4)", () => {
    const facts = { ...EMPTY, hasContractPostings: true };
    expect(seesTrialBalance(holding(...COST), facts)).toBe(false);
    expect(seesTrialBalance(holding(...COST, "contracts.contract.view_sensitive"), facts)).toBe(true);
  });

  it("needs pay sight once pay has posted (S3)", () => {
    const facts = { ...EMPTY, hasPayPostings: true };
    expect(seesTrialBalance(holding(...COST), facts)).toBe(false);
    expect(seesTrialBalance(holding(...COST, "hr.payroll.view"), facts)).toBe(true);
    // Pay rates are not needed: the books hold pay totals per location, never per person.
    expect(seesTrialBalance(holding(...COST, "hr.employee.view_sensitive"), facts)).toBe(false);
  });

  it("derives the pay and contract sources from one classification of every source", () => {
    expect([...PAY_SOURCE_TYPES].sort()).toEqual(["commission_statement", "contractor_payment", "pay_period"]);
    expect(CONTRACT_SOURCE_TYPES).toEqual(["contract_billing"]);
    expect(Object.keys(SOURCE_SIGHT)).toHaveLength(14);
  });

  it("names only real default accounts as pay accounts", () => {
    const keys = new Set<string>(DEFAULT_ACCOUNTS.map((account) => account.key));
    for (const key of PAY_ACCOUNT_KEYS) expect(keys.has(key)).toBe(true);
  });
});
