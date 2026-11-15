import {
  isModuleKey,
  isPlatformAuditAction,
  migrationErrorCode,
  moduleInfo,
  permissionDef,
  type PlatformAuditAction,
  type PlatformAuditActor,
  type PlatformAuditDetails,
  type PlatformAuditLimitChange,
} from "@workspace/shared";

/*
 * The platform audit log in words (docs/specs/platform-admin.md, part 3, "Screens", Audit log).
 * Everything here reads the shared, already redacted `PlatformAuditView`, so a line can only show
 * what the details hold: never company data and never a database error's text.
 */

/** What each of the six actions is called on screen. */
export const AUDIT_ACTION_LABELS: Record<PlatformAuditAction, string> = {
  "company.access_changed": "Changed company access",
  "support.requested": "Asked for support access",
  "support.approved": "Support access approved",
  "support.revoked": "Support access revoked",
  "company.migration_failed": "Database update failed",
  "company.migration_recovered": "Database updated after a failure",
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

/** How the details' numbers and dates are written: the console's number and date formats. */
export interface AuditFormat {
  count: (value: number) => string;
  date: (iso: string) => string;
}

/** One line of an entry's details: an optional lead-in such as "Switched on", then the text. */
export interface AuditDetailLine {
  label?: string;
  text: string;
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
 * An entry's details as lines (spec "Details"): what an access change switched, added, removed and
 * limited; a request's reason and end; a decision; a failed update's error code; a recovered
 * update's schema; or "Details hidden" for anything outside the allow-list.
 */
export function auditDetailLines(details: PlatformAuditDetails, format: AuditFormat): AuditDetailLine[] {
  switch (details.kind) {
    case "access_changed":
      return accessLines(details, format);
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
