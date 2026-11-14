import { SENSITIVE, type PermissionKey } from "./catalog";

/**
 * Audit actions whose entries carry commission plan terms (rates, tiers, targets, override, draw,
 * clawback) or an adjustment or reversal-decision reason, which may describe pay. The owner decided
 * (2026-11-14; ADR 0048 "Audit visibility") that these entries are visible only to roles that can see
 * pay: the Owner, or a holder of the pay `view_sensitive` key (`SENSITIVE.payRate`). Everyone else
 * still sees the row (who, when, what and on whom) but not its before and after, so the log stays
 * complete. A new commission audit action that carries terms or a reason must be added here; a test
 * in apps/api reads the commission services and fails until it is.
 */
export const PAY_SENSITIVE_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  "Added commission plan",
  "Edited commission plan",
  "Adjusted commission statement",
  "Accepted commission reversal",
  "Waived commission reversal",
]);

/** What a viewer without pay access reads in place of a pay-sensitive entry's before and after. */
export const HIDDEN_PAY_DETAILS = "Hidden: pay details";

/** Who is reading the audit log, as the pay-audit rule needs it (an engine `Access` fits). */
export interface PayAuditViewer {
  isOwner: boolean;
  permissions: ReadonlySet<PermissionKey>;
}

/**
 * Whether a viewer may read the details of pay-sensitive audit entries: the Owner, or a holder of
 * the pay view_sensitive key (owner decision 2026-11-14; ADR 0048 "Audit visibility").
 */
export function canSeePayAudit(viewer: PayAuditViewer): boolean {
  return viewer.isOwner || viewer.permissions.has(SENSITIVE.payRate);
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
 * The entry as this viewer may read it: unchanged when it is not pay-sensitive or the viewer can see
 * pay; otherwise the same row with each present before and after replaced by HIDDEN_PAY_DETAILS
 * (an empty side stays empty), so counts and exports match and nothing of the terms or reason leaks.
 */
export function redactPayAudit<T extends RedactableAudit>(entry: T, canSeePay: boolean): T {
  if (canSeePay || !isPaySensitiveAudit(entry.action)) return entry;
  return {
    ...entry,
    before: entry.before === null ? null : HIDDEN_PAY_DETAILS,
    after: entry.after === null ? null : HIDDEN_PAY_DETAILS,
  };
}
