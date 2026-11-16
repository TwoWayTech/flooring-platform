import {
  countsText,
  importAuditAction,
  importKind,
  IMPORT_WORDS,
  recordName,
  type ColumnMapping,
  type ImportChange,
  type ImportCounts,
  type ImportKind,
} from "@workspace/shared";
import type { AuditInput } from "../../core/access/audit";
import type { KindStore } from "./kind-store";

/** What an import batch is called in the audit log: "IMP-1001, customers.csv" (spec "Events and audit entries"). */
const batchLabel = (batch: { number: string; fileName: string }) => `${batch.number}, ${batch.fileName}`;

/**
 * The entry for one record an import wrote (ADR 0057 api 4.9, S-13): "Imported customer" with the
 * record as written, or "Updated customer by import" with the version it replaced. Each names the
 * batch, so the record's own history leads back to the file. Sensitive values in it are stripped
 * when the log is read without their key.
 */
export function recordEntry(store: KindStore, change: ImportChange, batchNumber: string): AuditInput {
  const kind = store.record(change.collection);
  const created = change.before === null;
  return {
    category: "data",
    action: created ? `Imported ${kind.noun}` : `Updated ${kind.noun} by import`,
    targetType: kind.targetType,
    targetId: change.id,
    targetLabel: recordName(change),
    before: created ? null : store.shape(change.collection, change.before),
    after: { ...(store.shape(change.collection, change.after) as object), batch: batchNumber },
  };
}

/**
 * The entry for one record an Undo put back (ADR 0057 api 4.9): "Removed imported customer" for a
 * created record, "Restored customer after undoing an import" with the version it went back to.
 */
export function undoRecordEntry(store: KindStore, change: ImportChange, batchNumber: string): AuditInput {
  const kind = store.record(change.collection);
  const created = change.before === null;
  return {
    category: "data",
    action: created ? `Removed imported ${kind.noun}` : `Restored ${kind.noun} after undoing an import`,
    targetType: kind.targetType,
    targetId: change.id,
    targetLabel: recordName(change),
    before: store.shape(change.collection, change.after),
    after: created
      ? { batch: batchNumber }
      : { ...(store.shape(change.collection, change.before) as object), batch: batchNumber },
  };
}

/** The batch's entry, as the spec words it: "Imported customers" with the counts text. */
export function batchEntry(batch: {
  id: string;
  number: string;
  kind: ImportKind;
  fileName: string;
  counts: ImportCounts;
}): AuditInput {
  return {
    category: "data",
    action: importAuditAction(batch.kind),
    targetType: "import_job",
    targetId: batch.id,
    targetLabel: batchLabel(batch),
    before: null,
    after: countsText(batch.counts),
  };
}

/** The Undo's entry, as the spec words it: "Undid import", from the counts to the records put back. */
export function undoBatchEntry(batch: {
  id: string;
  number: string;
  fileName: string;
  counts: ImportCounts;
}): AuditInput {
  return {
    category: "data",
    action: "Undid import",
    targetType: "import_job",
    targetId: batch.id,
    targetLabel: batchLabel(batch),
    before: countsText(batch.counts),
    after: IMPORT_WORDS.undoneAfter,
  };
}

/**
 * The entry for saved column choices (CLAUDE.md rule 10; ADR 0057 S-13): the spec wrote none, but
 * every change of a record is audited.
 */
export function mappingEntry(
  mapping: { id: string; kind: ImportKind; columns: ColumnMapping },
  before: ColumnMapping | null,
): AuditInput {
  return {
    category: "data",
    action: "Saved import columns",
    targetType: "import_mapping",
    targetId: mapping.id,
    targetLabel: importKind(mapping.kind).label,
    before,
    after: mapping.columns,
  };
}
