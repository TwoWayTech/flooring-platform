import Papa from "papaparse";

/** The byte-order mark, so Excel reads the CSV as UTF-8. */
const BOM = "﻿";

/**
 * A cell a spreadsheet would run as a formula (OWASP "CSV injection"): one that starts with `=`,
 * `+`, `-`, `@`, a tab or a carriage return. Anchored at the start only: Papa Parse's own pattern
 * for `escapeFormulae: true` (`/^[=+\-@\t\r].*$/`) misses a cell that holds a line break, and the
 * error report repeats cells exactly as the uploaded file had them (ADR 0057 S-15).
 */
export const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A table as CSV text, starting with the byte-order mark. With `escapeFormulas` (the default),
 * every cell that starts like a formula gets a leading `'`, so a spreadsheet shows it as text and
 * never runs it (ADR 0057 S-15). The import wizard's own files use it: templates and the error
 * report. Callers whose CSV is read by other software, such as the pay-period export, pass
 * `false` and keep their cells as they are (owner question 11).
 */
export function csvText(table: string[][], { escapeFormulas = true }: { escapeFormulas?: boolean } = {}): string {
  return BOM + Papa.unparse(table, escapeFormulas ? { escapeFormulae: FORMULA_START } : {});
}
