import { describe, expect, it } from "vitest";
import { SENSITIVE, type PermissionKey } from "../src/permissions/catalog";
import {
  canSeePayAudit,
  HIDDEN_PAY_DETAILS,
  isPaySensitiveAudit,
  PAY_SENSITIVE_AUDIT_ACTIONS,
  redactPayAudit,
} from "../src/permissions/pay-audit";

const held = (...keys: PermissionKey[]): ReadonlySet<PermissionKey> => new Set(keys);

describe("pay-sensitive audit entries (owner decision 2026-11-14; ADR 0048 'Audit visibility')", () => {
  it("lists the commission plan writes and the entries that carry a reason", () => {
    expect([...PAY_SENSITIVE_AUDIT_ACTIONS].sort()).toEqual([
      "Accepted commission reversal",
      "Added commission plan",
      "Adjusted commission statement",
      "Edited commission plan",
      "Waived commission reversal",
    ]);
    expect(isPaySensitiveAudit("Edited commission plan")).toBe(true);
    // No terms, no reason: these stay readable to every audit viewer.
    expect(isPaySensitiveAudit("Approved commission statement")).toBe(false);
    expect(isPaySensitiveAudit("Assigned commission plan")).toBe(false);
  });

  it("lets the Owner and the holder of the pay view_sensitive key see the details, and nobody else", () => {
    expect(SENSITIVE.payRate).toBe("hr.employee.view_sensitive");
    expect(canSeePayAudit({ isOwner: true, permissions: held() })).toBe(true);
    expect(canSeePayAudit({ isOwner: false, permissions: held("hr.employee.view_sensitive") })).toBe(true);
    expect(
      canSeePayAudit({
        isOwner: false,
        permissions: held("settings.audit.view", "hr.commission.manage", "sales.margin.view_sensitive"),
      }),
    ).toBe(false);
  });

  it("keeps the row and hides each present before and after for a viewer without pay access", () => {
    const entry = {
      id: "a1",
      action: "Adjusted commission statement",
      target: "Rae Anders, 2026-10",
      before: null,
      after: '{"reason":"Missed the spiff"}',
    };
    expect(redactPayAudit(entry, false)).toEqual({ ...entry, before: null, after: HIDDEN_PAY_DETAILS });
    const edit = { ...entry, action: "Edited commission plan", before: '{"baseRatePct":"4"}', after: "5" };
    expect(redactPayAudit(edit, false)).toEqual({ ...edit, before: HIDDEN_PAY_DETAILS, after: HIDDEN_PAY_DETAILS });
    expect(HIDDEN_PAY_DETAILS).toBe("Hidden: pay details");
  });

  it("leaves the entry unchanged for a pay viewer, and any other entry for everyone", () => {
    const entry = { action: "Added commission plan", before: null, after: '{"baseRatePct":"4"}' };
    expect(redactPayAudit(entry, true)).toBe(entry);
    const other = { action: "Approved commission statement", before: '{"status":"draft"}', after: "x" };
    expect(redactPayAudit(other, false)).toBe(other);
  });
});
