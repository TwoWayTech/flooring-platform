import type { ImportKindDef, ImportPlan } from "./types";

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
