import { CATEGORY_LABELS } from "./catalog-labels";
import type { DocLine } from "./documents";
import { dec } from "./money";
import type { Invoice } from "./types";
import { TAX_CATEGORY_LABELS } from "./us-pack/tax";

/** The category a credit note is reported under, because it has no lines to take one from. */
export const CREDIT_NOTE_CATEGORY = "credit_note";

/** The parts of a document line that a sales report reads. */
export type SalesLine = Pick<DocLine, "productId" | "quantity" | "unitPrice" | "unitCost"> & {
  category: DocLine["category"] | typeof CREDIT_NOTE_CATEGORY;
};

/**
 * The lines a sales report counts on one invoice. A credit note (ADR 0025) holds amounts and no
 * lines, so it counts as one line for its subtotal and cost. Without this, revenue and margin
 * would ignore the credit while profit by location, which reads the subtotal, subtracts it.
 */
export function salesLines(invoice: Invoice): readonly SalesLine[] {
  if (invoice.lines.length > 0 || dec(invoice.subtotal).isZero()) return invoice.lines;
  return [{ category: CREDIT_NOTE_CATEGORY, quantity: "1", unitPrice: invoice.subtotal, unitCost: invoice.cost }];
}

/** The name a sales report shows for a product category, a tax category or credit notes. */
export function salesCategoryLabel(key: string): string {
  if (key === CREDIT_NOTE_CATEGORY) return "Credit notes";
  return (
    CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS] ??
    TAX_CATEGORY_LABELS[key as keyof typeof TAX_CATEGORY_LABELS] ??
    key
  );
}
