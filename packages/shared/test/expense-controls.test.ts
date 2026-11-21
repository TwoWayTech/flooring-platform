import { describe, expect, it } from "vitest";
import { expenseApprovalLoosened, overtimeRuleChanged, type ExpenseSettings } from "../src";

const STORED: ExpenseSettings = { approvalRequired: true, approvalThreshold: "1000.00" };

const loosened = (patch: Partial<ExpenseSettings>, current: ExpenseSettings | null = STORED) =>
  expenseApprovalLoosened({ ...STORED, ...current, ...patch }, current);

describe("expense approval only an Owner may loosen (ADR 0061 decision 6, ADR 0063)", () => {
  it("EC1 switching the check off loosens; switching it on does not", () => {
    expect(loosened({ approvalRequired: false })).toBe(true);
    expect(loosened({ approvalRequired: true }, { ...STORED, approvalRequired: false })).toBe(false);
  });

  it("EC2 a higher amount, or one where every expense waited, loosens", () => {
    expect(loosened({ approvalThreshold: "1000.01" })).toBe(true);
    expect(loosened({ approvalThreshold: "50" }, { ...STORED, approvalThreshold: "" })).toBe(true);
  });

  it("EC3 the same, a lower or an equal amount, or an empty one (every expense waits), tightens or keeps", () => {
    expect(loosened({})).toBe(false);
    expect(loosened({ approvalThreshold: "999.99" })).toBe(false);
    expect(loosened({ approvalThreshold: "1000" })).toBe(false);
    expect(loosened({ approvalThreshold: "" })).toBe(false);
  });

  it("EC4 while the check is off its amount loosens nothing, and switching it on with any amount tightens", () => {
    const off = { approvalRequired: false, approvalThreshold: "10.00" };
    expect(loosened({ approvalThreshold: "5000.00" }, off)).toBe(false);
    expect(loosened({ approvalRequired: true, approvalThreshold: "5000.00" }, off)).toBe(false);
  });

  it("EC5 a stored section the rule refuses can't be compared, so any change to it loosens", () => {
    const malformed = { approvalRequired: true, approvalThreshold: "abc" };
    expect(loosened({ approvalThreshold: "10.00" }, malformed)).toBe(true);
    expect(expenseApprovalLoosened(STORED, null)).toBe(true);
    expect(expenseApprovalLoosened(STORED, { approvalRequired: "yes" } as unknown as ExpenseSettings)).toBe(true);
  });
});

describe("a new overtime rule needs a step-up; the holiday calendar alone does not (ADR 0063)", () => {
  it("OR1 the same rule is no change, another rule or none stored is", () => {
    expect(overtimeRuleChanged({ overtimeRule: "federal" }, { overtimeRule: "federal" })).toBe(false);
    expect(overtimeRuleChanged({ overtimeRule: "federal" }, { overtimeRule: "california" })).toBe(true);
    expect(overtimeRuleChanged({ overtimeRule: "federal" }, undefined)).toBe(true);
    expect(overtimeRuleChanged({ overtimeRule: "federal" }, {})).toBe(true);
  });
});
