import { describe, expect, it } from "vitest";
import { SENSITIVE, type PermissionKey } from "../src/permissions/catalog";
import {
  canSeePayAudit,
  HIDDEN_PAY_DETAILS,
  isPaySensitiveAudit,
  PAY_SENSITIVE_AUDIT_ACTIONS,
  payAuditDetailsVisible,
  redactPayAudit,
  type PayAuditSubject,
  type ScopedPayAuditViewer,
} from "../src/permissions/pay-audit";

const held = (...keys: PermissionKey[]): ReadonlySet<PermissionKey> => new Set(keys);

/** A non-Owner holding the pay key, linked to employee "e-mia", at the given scope. */
const payViewer = (patch: Partial<ScopedPayAuditViewer> = {}): ScopedPayAuditViewer => ({
  isOwner: false,
  permissions: held("settings.audit.view", "hr.employee.view_sensitive"),
  dataScope: "branch",
  employeeId: "e-mia",
  ...patch,
});
const person = (id: string, managerId: string | null = null): PayAuditSubject => ({ kind: "person", id, managerId });
const company: PayAuditSubject = { kind: "company" };

describe("pay-sensitive audit entries (owner decision 2026-11-14; ADR 0048 'Audit visibility')", () => {
  it("lists the commission plan writes and the entries that carry a reason, bonuses and exclusions included", () => {
    expect([...PAY_SENSITIVE_AUDIT_ACTIONS].sort()).toEqual([
      "Accepted commission reversal",
      "Added bonus",
      "Added commission plan",
      "Adjusted commission statement",
      "Brought back into pay period",
      "Edited commission plan",
      "Left out of pay period",
      "Voided bonus",
      "Waived commission reversal",
    ]);
    expect(isPaySensitiveAudit("Edited commission plan")).toBe(true);
    // Owner decision 2026-11-15: bonus and pay-run exclusion reasons are hidden like commission ones.
    expect(isPaySensitiveAudit("Added bonus")).toBe(true);
    expect(isPaySensitiveAudit("Left out of pay period")).toBe(true);
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

  it("hides a bonus reason from an audit viewer without pay access", () => {
    const bonus = { action: "Voided bonus", before: '{"reason":"Storm cleanup"}', after: '{"voided":true}' };
    expect(redactPayAudit(bonus, false)).toEqual({ ...bonus, before: HIDDEN_PAY_DETAILS, after: HIDDEN_PAY_DETAILS });
  });
});

describe("pay-sensitive details within the viewer's data scope (owner decision 2026-11-15; ADR 0048)", () => {
  it("shows the Owner every entry, whatever the scope, link or keys", () => {
    const owner = payViewer({ isOwner: true, permissions: held(), dataScope: "own", employeeId: null });
    expect(payAuditDetailsVisible(owner, person("e-rae", "e-other"))).toBe(true);
    expect(payAuditDetailsVisible(owner, company)).toBe(true);
  });

  it("shows nothing to a non-Owner without the pay view_sensitive key, even at scope all", () => {
    const noKey = payViewer({ permissions: held("settings.audit.view", "hr.commission.manage"), dataScope: "all" });
    expect(payAuditDetailsVisible(noKey, person("e-mia"))).toBe(false);
    expect(payAuditDetailsVisible(noKey, company)).toBe(false);
  });

  it("shows a pay viewer at scope all every person and the plan terms", () => {
    const all = payViewer({ dataScope: "all", employeeId: null });
    expect(payAuditDetailsVisible(all, person("e-rae", "e-other"))).toBe(true);
    expect(payAuditDetailsVisible(all, company)).toBe(true);
  });

  it("needs scope all for an entry about no single person or an unresolved one", () => {
    expect(payAuditDetailsVisible(payViewer({ dataScope: "branch" }), company)).toBe(false);
    expect(payAuditDetailsVisible(payViewer({ dataScope: "own" }), company)).toBe(false);
  });

  it("shows a branch pay viewer themselves and their direct reports, nobody else", () => {
    const branch = payViewer({ dataScope: "branch" });
    expect(payAuditDetailsVisible(branch, person("e-mia", "e-boss"))).toBe(true);
    expect(payAuditDetailsVisible(branch, person("e-rae", "e-mia"))).toBe(true);
    expect(payAuditDetailsVisible(branch, person("e-luis", "e-other"))).toBe(false);
    expect(payAuditDetailsVisible(branch, person("e-luis", null))).toBe(false);
  });

  it("shows an own pay viewer only themselves, not their reports", () => {
    const own = payViewer({ dataScope: "own" });
    expect(payAuditDetailsVisible(own, person("e-mia"))).toBe(true);
    expect(payAuditDetailsVisible(own, person("e-rae", "e-mia"))).toBe(false);
  });

  it("shows a pay viewer whose sign-in is not linked nobody below scope all", () => {
    const unlinked = payViewer({ dataScope: "branch", employeeId: null });
    expect(payAuditDetailsVisible(unlinked, person("e-rae", null))).toBe(false);
    expect(payAuditDetailsVisible(unlinked, person("e-rae", "e-mia"))).toBe(false);
  });
});
