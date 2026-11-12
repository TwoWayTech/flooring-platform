import type { AuditCategory, ColumnMapping, ImportChange, ImportCounts, ImportKind } from "@workspace/shared";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appendOnly, at, business, userRef } from "../columns";

/**
 * The company's audit log, append-only: who, what, when, before and after, IP and device. Nobody
 * edits or deletes a row, admins included (blueprint "Security": audit log; role rule 8). The
 * actor is a user id, not a name (data-model.md, Points for the real build).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    ...appendOnly(),
    at: at().notNull().defaultNow(),
    actorUserId: userRef(),
    actorRole: text().notNull().default(""),
    /** Set when a platform admin acted under a support grant; also logged in platform_audit_log. */
    supportGrantId: text(),
    category: text().$type<AuditCategory>().notNull(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    targetLabel: text().notNull().default(""),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);

/** An import run, with the before and after of every record it changed, so Undo can restore them (ADR 0019). */
export const importJobs = pgTable(
  "import_jobs",
  {
    ...business(),
    number: text().notNull(),
    kind: text().$type<ImportKind>().notNull(),
    fileName: text().notNull(),
    mapping: jsonb().$type<ColumnMapping>().notNull(),
    counts: jsonb().$type<ImportCounts>().notNull(),
    changes: jsonb().$type<ImportChange[]>().notNull().default([]),
    undoneAt: at(),
    undoneBy: userRef(),
  },
  (table) => [uniqueIndex("import_jobs_number_uidx").on(table.number)],
);

/** A column mapping saved for the next file of the same kind (spec G1). */
export const importMappings = pgTable(
  "import_mappings",
  {
    ...business(),
    kind: text().$type<ImportKind>().notNull(),
    columns: jsonb().$type<ColumnMapping>().notNull(),
  },
  (table) => [uniqueIndex("import_mappings_kind_uidx").on(table.kind)],
);

/** A file stored through the StorageProvider and attached to a record (blueprint "attachments"). */
export const attachments = pgTable("attachments", {
  ...business(),
  ownerType: text().notNull(),
  ownerId: uuid().notNull(),
  /** Why it is attached: proof, document, receipt, signed copy. */
  purpose: text().notNull().default("document"),
  storageKey: text().notNull(),
  name: text().notNull(),
  /** The real type, read from the file's first bytes. */
  contentType: text().notNull(),
  size: integer().notNull(),
  uploadedAt: at().notNull().defaultNow(),
});
