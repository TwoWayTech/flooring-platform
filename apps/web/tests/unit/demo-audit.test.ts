import { describe, expect, it } from "vitest";
import { HIDDEN_PAY_DETAILS, SENSITIVE, type AuditEntry, type PermissionKey } from "@workspace/shared";
import { demoAuditAsSeen } from "@/lib/api/demo/audit-view";

/** One audit entry with a before and an after, as the demo stores it. */
function entry(action: string): AuditEntry {
  return {
    id: action,
    at: "2026-11-15T09:00",
    actorName: "Dana Whitfield",
    actorRole: "Owner",
    category: "data",
    action,
    target: "Someone",
    before: '{"reason":"before"}',
    after: '{"reason":"after"}',
  };
}

const entries = [entry("Added bonus"), entry("Edited commission plan"), entry("Edited customer")];

/** A viewer as the demo store passes it: their access and their linked employee. */
function viewer(over: { isOwner?: boolean; keys?: PermissionKey[]; dataScope?: "all" | "branch" | "own" }) {
  return {
    isOwner: over.isOwner ?? false,
    permissions: new Set<PermissionKey>(over.keys ?? []),
    dataScope: over.dataScope ?? "all",
    employeeId: "emp-1",
  };
}

const hidden = (seen: AuditEntry[]) => seen.map((e) => [e.action, e.after === HIDDEN_PAY_DETAILS]);

// First review of PR #32: demo entries name no person, so below scope `all` only the Owner reads pay details.
describe("demo audit log by viewer (ADR 0048 'Audit visibility')", () => {
  it("shows the Owner every entry, whatever their scope", () => {
    expect(hidden(demoAuditAsSeen(viewer({ isOwner: true, dataScope: "own" }), entries))).toEqual([
      ["Added bonus", false],
      ["Edited commission plan", false],
      ["Edited customer", false],
    ]);
  });

  it("shows a company-wide pay viewer the pay details", () => {
    expect(hidden(demoAuditAsSeen(viewer({ keys: [SENSITIVE.payRate] }), entries))).toEqual([
      ["Added bonus", false],
      ["Edited commission plan", false],
      ["Edited customer", false],
    ]);
  });

  it("hides pay details from a pay viewer below scope all, and from anyone without the pay key", () => {
    for (const reader of [
      viewer({ keys: [SENSITIVE.payRate], dataScope: "branch" }),
      viewer({ keys: [SENSITIVE.payRate], dataScope: "own" }),
      viewer({ keys: ["settings.audit.view"] }),
    ]) {
      const seen = demoAuditAsSeen(reader, entries);
      expect(hidden(seen)).toEqual([
        ["Added bonus", true],
        ["Edited commission plan", true],
        ["Edited customer", false],
      ]);
      expect(seen.map((e) => e.before)).toEqual([HIDDEN_PAY_DETAILS, HIDDEN_PAY_DETAILS, '{"reason":"before"}']);
    }
  });
});
