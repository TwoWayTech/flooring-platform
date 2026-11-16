import { dec } from "../money";
import type { Product } from "../types";
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

/** Whether two stored decimals differ as numbers ("3.4" and "3.4000" do not); a missing value differs only from a present one. */
function decimalChanged(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return (a ?? "") !== (b ?? "");
  return !dec(a).eq(b);
}

/** What the API and the demo know about a product when an Undo would put it back (ADR 0057 M4, M6). */
export interface ProductUndoFacts {
  /** Whether the product has any stock movement or roll now, deleted rolls and stock in transit included. */
  hasStock: (productId: string) => boolean;
  /** Whether a supplier is still live (soft-deleted on the API, removed in the demo). */
  supplierLive: (supplierId: string) => boolean;
}

/**
 * Why an Undo may not put an updated product back, or null (ADR 0057 S-5, M4, M6): once the
 * product has stock history, the cost, category, selling unit, coverage and roll width the
 * import changed stay, because stock is valued at them; and the earlier supplier it would point
 * to again must still be live. Created products and other records are left to the reference check.
 */
export function productUndoProblem(change: ImportChange, facts: ProductUndoFacts): string | null {
  if (change.collection !== "products" || change.before === null) return null;
  const before = change.before as Product;
  const after = change.after as Product;
  const valuationChanged =
    decimalChanged(before.cost, after.cost) ||
    before.category !== after.category ||
    before.unit !== after.unit ||
    decimalChanged(before.sqFtPerCarton, after.sqFtPerCarton) ||
    before.widthFt !== after.widthFt;
  if (valuationChanged && facts.hasStock(before.id)) {
    return `${before.sku} has stock history now, so its cost, category, selling unit, coverage and roll width can't be put back.`;
  }
  if (before.supplierId && !facts.supplierLive(before.supplierId)) {
    return `${before.sku}'s earlier supplier was removed, so the import cannot be undone.`;
  }
  return null;
}
