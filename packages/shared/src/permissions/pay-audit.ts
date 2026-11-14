import { seesPersonRecords } from "../hr/people";
import { SENSITIVE, type PermissionKey } from "./catalog";
import type { DataScope } from "./roles";

/**
 * Audit actions whose entries carry commission plan terms (rates, tiers, targets, override, draw,
 * clawback) or a reason that may describe pay: a commission adjustment or reversal decision, a bonus,
 * or a pay-run exclusion. The owner decided (2026-11-14; ADR 0048 "Audit visibility") that the
 * commission ones are visible only to roles that can see pay, and (2026-11-15) that bonus and pay-run
 * exclusion reasons follow the same rule; "Brought back into pay period" is written by the same call
 * as "Left out of pay period", so it is listed with it. Everyone else still sees the row (who, when,
 * what and on whom) but not its before and after, so the log stays complete. A new pay audit action
 * that carries terms or a reason must be added here; a test in apps/api reads the pay services and
 * fails until it is.
 */
export const PAY_SENSITIVE_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  "Added commission plan",
  "Edited commission plan",
  "Adjusted commission statement",
  "Accepted commission reversal",
  "Waived commission reversal",
  "Added bonus",
  "Voided bonus",
  "Left out of pay period",
  "Brought back into pay period",
]);

/** What a viewer without pay access reads in place of a pay-sensitive entry's before and after. */
export const HIDDEN_PAY_DETAILS = "Hidden: pay details";

/** Who is reading the audit log, as the pay-access check needs it (an engine `Access` fits). */
export interface PayAuditViewer {
  isOwner: boolean;
  permissions: ReadonlySet<PermissionKey>;
}

/**
 * Who is reading the audit log, as the per-entry rule needs it: their access (an engine `Access`
 * fits) and the employee their sign-in is linked to, for the HR person scope (hr.md "Data scope").
 */
export interface ScopedPayAuditViewer extends PayAuditViewer {
  dataScope: DataScope;
  /** The viewer's own live employee id; null when their sign-in is not linked to one. */
  employeeId: string | null;
}

/**
 * Whom a pay-sensitive entry is about: one person (a bonus, an exclusion, a commission statement),
 * with their current manager for the scope rule; or the company, for an entry about no single person
 * (commission plan terms). An entry whose person can't be resolved is passed as `company`, so it
 * needs company-wide scope (owner decision 2026-11-15, safest option).
 */
export type PayAuditSubject = { kind: "person"; id: string; managerId: string | null } | { kind: "company" };

/**
 * Whether a viewer may read the details of pay-sensitive audit entries at all: the Owner, or a holder
 * of the pay view_sensitive key (owner decision 2026-11-14; ADR 0048 "Audit visibility"). This is the
 * first gate only; whether one entry's details show is `payAuditDetailsVisible`.
 */
export function canSeePayAudit(viewer: PayAuditViewer): boolean {
  return viewer.isOwner || viewer.permissions.has(SENSITIVE.payRate);
}

/**
 * Whether this viewer reads one pay-sensitive entry's before and after (owner decision 2026-11-15;
 * ADR 0048 "Audit visibility"). The Owner sees every rep. Anyone else needs the pay view_sensitive
 * key, and then sees only people inside their data scope (`seesPersonRecords`: `all` everyone,
 * `branch` themselves and their direct reports, `own` themselves). An entry about no single person,
 * or whose person is unknown, needs scope `all`. Deny by default: no key, no details.
 */
export function payAuditDetailsVisible(viewer: ScopedPayAuditViewer, subject: PayAuditSubject): boolean {
  if (viewer.isOwner) return true;
  if (!viewer.permissions.has(SENSITIVE.payRate)) return false;
  if (viewer.dataScope === "all") return true;
  if (subject.kind === "company") return false;
  return seesPersonRecords(viewer.dataScope, viewer.employeeId, subject);
}

/** Whether an audit entry's action is one whose before and after carry plan terms or a reason. */
export function isPaySensitiveAudit(action: string): boolean {
  return PAY_SENSITIVE_AUDIT_ACTIONS.has(action);
}

/** An audit entry as the redaction rule sees it: its action and its before and after text. */
export interface RedactableAudit {
  action: string;
  before: string | null;
  after: string | null;
}

/**
 * The entry as this viewer may read it: unchanged when it is not pay-sensitive or the viewer may read
 * its details (`canSeePay`: `payAuditDetailsVisible` for this entry's subject); otherwise the same row
 * with each present before and after replaced by HIDDEN_PAY_DETAILS (an empty side stays empty), so
 * counts and exports match and nothing of the terms or reason leaks.
 */
export function redactPayAudit<T extends RedactableAudit>(entry: T, canSeePay: boolean): T {
  if (canSeePay || !isPaySensitiveAudit(entry.action)) return entry;
  return {
    ...entry,
    before: entry.before === null ? null : HIDDEN_PAY_DETAILS,
    after: entry.after === null ? null : HIDDEN_PAY_DETAILS,
  };
}
