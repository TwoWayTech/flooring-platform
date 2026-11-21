/**
 * The orders list's money column: the order's total less what was paid on its bills, so it also
 * counts goods not billed yet, unlike "owed to suppliers", which counts bills only (spec rule 24;
 * click-through #21).
 */
export const PO_NOT_PAID_HEADER = "Not yet billed or unpaid";

/** Under the orders list: why its column's total is larger than what is owed on bills. */
export const PO_NOT_PAID_NOTE = `Owed counts billed amounts only; "${PO_NOT_PAID_HEADER}" also counts goods not billed yet.`;

/** The line under every purchasing list: what is owed on bills, after the amount. */
export const OWED_ON_BILLS = "owed to suppliers on bills.";
