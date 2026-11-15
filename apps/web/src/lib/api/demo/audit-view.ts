import { payAuditDetailsVisible, redactPayAudit, type AuditEntry, type ScopedPayAuditViewer } from "@workspace/shared";

/**
 * The demo audit log as a viewer may read it: plan terms and pay reasons only for the Owner, and for
 * pay viewers only about people in their data scope (owner decisions 2026-11-14 and 2026-11-15; ADR
 * 0048 "Audit visibility"), through the same shared rule the API uses. The API looks up each entry's
 * person; demo entries carry no person id, so each one counts as about the company, and a non-Owner
 * pay viewer below scope `all` sees no pay details. That is stricter than the API, never looser.
 */
export function demoAuditAsSeen(viewer: ScopedPayAuditViewer, entries: readonly AuditEntry[]): AuditEntry[] {
  const seesPay = payAuditDetailsVisible(viewer, { kind: "company" });
  return entries.map((entry) => redactPayAudit(entry, seesPay));
}
