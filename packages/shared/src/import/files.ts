import type { ImportKindDef, ImportPlan, ImportTable } from "./types";

/** The demo's upload limit (spec G1 step 3). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * The template for a kind (spec G1 step 2): a header row of the column labels, required ones
 * marked with an asterisk, then two example rows.
 */
export function templateTable(def: ImportKindDef): string[][] {
  return [
    def.fields.map((f) => (f.required ? `${f.label} *` : f.label)),
    def.fields.map((f) => f.examples[0]),
    def.fields.map((f) => f.examples[1]),
  ];
}

/**
 * The error report (spec G1 step 7): one line per problem, with the row number in the file, the
 * column, the value as typed and what is wrong, so the file can be fixed and imported again.
 */
export function errorTable(def: ImportKindDef, plan: Pick<ImportPlan, "rows">): string[][] {
  const labelOf = (key: string | null) => def.fields.find((f) => f.key === key)?.label ?? "Whole row";
  const lines = plan.rows.flatMap((row) =>
    row.problems.map((p) => [String(row.line), labelOf(p.field), p.field ? (row.cells[p.field] ?? "") : "", p.message]),
  );
  return [["Row", "Column", "Value", "Problem"], ...lines];
}

/** The column that tells what is wrong with each row of the rows-to-fix file. */
export const FIX_ROWS_PROBLEMS = "Problems";

/**
 * The rows to fix (spec G1 step 7; click-through #52): the rows left out, in the file's own
 * columns, as typed, with a last column saying what is wrong with each. Fixed and imported again
 * with the same column choices, they go through without retyping. A row is found by its number in
 * the file (the header is row 1), which the dry run keeps for blank rows too.
 */
export function fixRowsTable(def: ImportKindDef, table: ImportTable, plan: Pick<ImportPlan, "rows">): string[][] {
  const labelOf = (key: string | null) => def.fields.find((f) => f.key === key)?.label;
  const width = table.headers.length;
  const rows = plan.rows
    .filter((row) => row.action === "error")
    .map((row) => {
      const cells = table.rows[row.line - 2] ?? [];
      const padded = Array.from({ length: width }, (_, i) => cells[i] ?? "");
      const problems = row.problems.map((p) => {
        const label = labelOf(p.field);
        return label ? `${label}: ${p.message}` : p.message;
      });
      return [...padded, problems.join(" ")];
    });
  return [[...table.headers, FIX_ROWS_PROBLEMS], ...rows];
}
