import { importKind } from "./kinds";
import type { ImportBatch, ImportBatchSummary, ImportChange, ImportCounts, ImportKind } from "./types";

/** A readable name for a changed record in an Undo message: its name, SKU, number or roll number. */
export function recordName(change: ImportChange): string {
  const r = (change.after ?? {}) as { name?: string; sku?: string; number?: string; rollNumber?: string };
  return r.name ?? r.sku ?? r.number ?? r.rollNumber ?? "A record";
}

/** The counts as the audit log words them: "2 created, 0 updated, 0 skipped, 1 with errors". */
export function countsText(counts: ImportCounts): string {
  return `${counts.create} created, ${counts.update} updated, ${counts.skip} skipped, ${counts.error} with errors`;
}

/**
 * A batch as screens and responses get it (ADR 0057 S-15): the saved record versions never leave
 * the store or the database. Built field by field, so a field added to the batch later is not
 * sent until it is named here.
 */
export function batchSummary(batch: ImportBatch): ImportBatchSummary {
  return {
    id: batch.id,
    number: batch.number,
    kind: batch.kind,
    fileName: batch.fileName,
    at: batch.at,
    byName: batch.byName,
    mapping: batch.mapping,
    counts: batch.counts,
    undoneAt: batch.undoneAt,
    undoneBy: batch.undoneBy,
  };
}

/** The audit action of an import (spec "Events and audit entries"): "Imported customer addresses". */
export function importAuditAction(kind: ImportKind): string {
  return `Imported ${importKind(kind).label.toLowerCase()}`;
}

/** The words an import and its Undo refuse or record with, the same on the API and in the demo (ADR 0057). */
export const IMPORT_WORDS = {
  nothing: "Nothing to import: every row is skipped or has errors.",
  planChanged: "The records changed since you checked this file. Check it again before importing.",
  gone: "This import no longer exists.",
  alreadyUndone: (number: string) => `${number} was already undone.`,
  changed: (name: string) => `${name} changed after the import, so the import cannot be undone.`,
  inUse: (name: string) => `${name} is already used by other records, so the import cannot be undone.`,
  undoneAfter: "records put back as before the import",
} as const;
