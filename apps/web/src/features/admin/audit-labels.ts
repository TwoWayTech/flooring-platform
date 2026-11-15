import {
  isModuleKey,
  isPlatformAuditAction,
  migrationErrorCode,
  moduleInfo,
  permissionDef,
  PRODUCT_LABELS,
  type PlatformAuditAction,
  type PlatformAuditActor,
  type PlatformAuditDetails,
  type PlatformAuditLimitChange,
  type PlatformAuditPlanChange,
} from "@workspace/shared";
import { STATUS } from "./company-status";

/*
 * The platform audit log in words (docs/specs/platform-admin.md, part 3, "Screens", Audit log).
 * Everything here reads the shared, already redacted `PlatformAuditView`, so a line can only show
 * what the details hold: never company data and never a database error's text.
 */

/** What each of the thirteen actions is called on screen (part 3, and part 2's plan and status actions). */
export const AUDIT_ACTION_LABELS: Record<PlatformAuditAction, string> = {
  "company.access_changed": "Changed company access",
  "support.requested": "Asked for support access",
  "support.approved": "Support access approved",
  "support.revoked": "Support access revoked",
  "company.migration_failed": "Database update failed",
  "company.migration_recovered": "Database updated after a failure",
  "company.suspended": "Suspended company",
  "company.reinstated": "Reinstated company",
  "company.cancelled": "Cancelled company",
  "plan.created": "Created plan",
  "plan.changed": "Changed plan",
  "plan.retired": "Retired plan",
  "plan.restored": "Restored plan",
};

/** An action's label; an action this build doesn't know shows its stored name. */
export function auditActionLabel(action: string): string {
  return isPlatformAuditAction(action) ? AUDIT_ACTION_LABELS[action] : action;
}

/**
 * Who made an entry (spec "Who"). Company people are never named: an Owner's approval reads "The
 * company's Owner", whoever it was.
 */
export function auditActorText(actor: PlatformAuditActor): string {
  switch (actor.kind) {
    case "platform_admin":
      return actor.name;
    case "company_user":
      return "The company's Owner";
    case "system":
      return "System (database update)";
    case "unknown":
      return "Unknown";
  }
}

/**
 * How the details' numbers, prices and dates are written: the console's number and date formats.
 * `money` takes a decimal string, as plan prices are stored (CLAUDE.md rule 6).
 */
export interface AuditFormat {
  count: (value: number) => string;
  money: (value: string) => string;
  date: (iso: string) => string;
}

/**
 * One line of an entry's details: an optional lead-in such as "Switched on", then the text. A
 * quiet line, such as "Reason hidden", is shown muted.
 */
export interface AuditDetailLine {
  label?: string;
  text: string;
  quiet?: boolean;
}

/** A module's label, or its key for a module this build doesn't know. */
function moduleText(key: string): string {
  return isModuleKey(key) ? moduleInfo(key).label : key;
}

/** A permission's label, or its key for a retired or unknown one. */
function permissionText(key: string): string {
  return permissionDef(key)?.label ?? key;
}

function limitText(change: PlatformAuditLimitChange, format: AuditFormat): string {
  const side = (value: number | null) => (value === null ? "No limit" : format.count(value));
  return `${side(change.from)} → ${side(change.to)}`;
}

function plural(count: number, one: string, many: string, format: AuditFormat): string {
  return `${format.count(count)} ${count === 1 ? one : many}`;
}

function accessLines(details: Extract<PlatformAuditDetails, { kind: "access_changed" }>, format: AuditFormat) {
  const lines: AuditDetailLine[] = [];
  const list = (label: string, items: string[], name: (key: string) => string) => {
    if (items.length > 0) lines.push({ label, text: items.map(name).join(", ") });
  };
  list("Switched on", details.modulesSwitchedOn, moduleText);
  list("Switched off", details.modulesSwitchedOff, moduleText);
  list("Added", details.keysAdded, permissionText);
  list("Removed", details.keysRemoved, permissionText);
  if (details.userLimit) lines.push({ label: "User limit", text: limitText(details.userLimit, format) });
  if (details.branchLimit) lines.push({ label: "Branch limit", text: limitText(details.branchLimit, format) });
  // Rows written are the API's bookkeeping; a save that wrote none (every demo save) says nothing.
  if (details.overrideRows > 0 || details.limitRows > 0) {
    const overrides = plural(details.overrideRows, "override row", "override rows", format);
    const limits = plural(details.limitRows, "limit row", "limit rows", format);
    lines.push({ text: `${overrides}, ${limits} written` });
  }
  return lines.length > 0 ? lines : [{ text: "No change recorded" }];
}

/**
 * An admin's reason on a plan or status entry (spec part 2, "Screens", Audit log), or "Reason
 * hidden" when the viewer may not read it: the API and the demo send it as null then.
 */
function reasonLine(reason: string | null): AuditDetailLine {
  return reason === null ? { text: "Reason hidden", quiet: true } : { label: "Reason", text: reason };
}

/** What each changeable plan field is called in a "Changed plan" entry. */
const PLAN_FIELD_LABELS: Record<PlatformAuditPlanChange["field"], string> = {
  name: "Name",
  monthlyPrice: "Monthly price",
  yearlyPrice: "Yearly price",
  modules: "Modules",
  maxUsers: "User limit",
  maxBranches: "Branch limit",
};

function modulesText(modules: readonly string[]): string {
  return modules.length === 0 ? "None" : modules.map(moduleText).join(", ");
}

/** One changed plan field as "old → new"; prices through the money format, a missing limit as "No limit". */
function planChangeText(change: PlatformAuditPlanChange, format: AuditFormat): string {
  switch (change.field) {
    case "name":
      return `${change.from} → ${change.to}`;
    case "monthlyPrice":
    case "yearlyPrice":
      return `${format.money(change.from)} → ${format.money(change.to)}`;
    case "modules":
      return `${modulesText(change.from)} → ${modulesText(change.to)}`;
    case "maxUsers":
    case "maxBranches":
      return limitText(change, format);
  }
}

function planCreatedLines(
  details: Extract<PlatformAuditDetails, { kind: "plan_created" }>,
  format: AuditFormat,
): AuditDetailLine[] {
  return [
    { label: "Plan", text: `${details.name} (${details.key})` },
    { label: "Product", text: PRODUCT_LABELS[details.product] },
    { label: "Monthly price", text: format.money(details.monthlyPrice) },
    { label: "Yearly price", text: format.money(details.yearlyPrice) },
    { label: "Modules", text: modulesText(details.modules) },
    { label: "User limit", text: format.count(details.maxUsers) },
    { label: "Branch limit", text: format.count(details.maxBranches) },
    reasonLine(details.reason),
  ];
}

/**
 * An entry's details as lines (spec "Details"; part 2, "Screens", Audit log): what an access change
 * switched, added, removed and limited; a request's reason and end; a decision; a failed update's
 * error code; a recovered update's schema; a status change as "Active → Suspended"; a plan's fields
 * or its changes, prices through the money format; a plan retired or restored; the admin's reason
 * or "Reason hidden"; or "Details hidden" for anything outside the allow-list.
 */
export function auditDetailLines(details: PlatformAuditDetails, format: AuditFormat): AuditDetailLine[] {
  switch (details.kind) {
    case "access_changed":
      return accessLines(details, format);
    case "status_changed":
      return [{ text: `${STATUS[details.from].label} → ${STATUS[details.to].label}` }, reasonLine(details.reason)];
    case "plan_created":
      return planCreatedLines(details, format);
    case "plan_changed":
      return [
        ...details.changes.map((change) => ({
          label: PLAN_FIELD_LABELS[change.field],
          text: planChangeText(change, format),
        })),
        reasonLine(details.reason),
      ];
    case "plan_active":
      return [{ text: details.active ? "Restored" : "Retired" }, reasonLine(details.reason)];
    case "support_requested":
      return [{ text: `“${details.reason}”` }, { text: `Ends ${format.date(details.expiresAt)}` }];
    case "support_decided":
      return [{ text: details.decision === "approved" ? "Approved" : "Revoked" }];
    case "migration_failed": {
      const code = migrationErrorCode(details.code);
      return [{ text: code ? `Error code ${code}` : "No error code recorded" }];
    }
    case "migration_recovered":
      return [{ text: details.version ? `Now on schema ${details.version}` : "Schema not recorded" }];
    case "hidden":
      return [{ text: "Details hidden" }];
  }
}

/** An entry's details in one line, for the table's search and filters. */
export function auditDetailsText(details: PlatformAuditDetails, format: AuditFormat): string {
  return auditDetailLines(details, format)
    .map((line) => (line.label ? `${line.label}: ${line.text}` : line.text))
    .join("; ");
}
