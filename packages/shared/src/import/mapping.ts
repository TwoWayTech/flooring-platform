import { fold } from "./fields";
import type { ColumnMapping, ImportField, ImportKindDef } from "./types";

/** A header reduced to letters and digits, so "E-mail", "e mail" and "EMAIL" compare equal. */
const squash = (text: string) => fold(text).replace(/[^a-z0-9]/g, "");

/** The names a header may carry for a field: its key, its label and its aliases. */
const namesOf = (field: ImportField) => [field.key, field.label, ...(field.aliases ?? [])].map(squash);

/**
 * Matches the file's headers to the kind's fields (spec G1 "Map columns: auto-match by header
 * name"). A saved mapping wins where its header is in this file; otherwise a header matches a
 * field's key, label or one of its aliases. Each header feeds one field at most. A field in
 * `skip` is never matched, not even from a saved mapping: the sensitive columns the person
 * can't use (ADR 0057 S-20).
 */
export function autoMap(
  def: ImportKindDef,
  headers: readonly string[],
  saved?: ColumnMapping,
  skip: ReadonlySet<string> = new Set(),
): ColumnMapping {
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const field of def.fields) {
    if (skip.has(field.key)) {
      mapping[field.key] = null;
      continue;
    }
    const remembered = saved?.[field.key];
    const header =
      remembered && headers.includes(remembered) && !used.has(remembered)
        ? remembered
        : headers.find((h) => !used.has(h) && namesOf(field).includes(squash(h)));
    mapping[field.key] = header ?? null;
    if (header) used.add(header);
  }
  return mapping;
}

/** What stops a mapping from being checked: a required field with no column, or a column used twice. */
export function mappingProblems(def: ImportKindDef, mapping: ColumnMapping): string[] {
  const problems = def.fields
    .filter((f) => f.required && !mapping[f.key])
    .map((f) => `Choose the column for ${f.label}.`);
  const seen = new Map<string, string>();
  for (const field of def.fields) {
    const header = mapping[field.key];
    if (!header) continue;
    const other = seen.get(header);
    if (other) problems.push(`“${header}” is chosen for both ${other} and ${field.label}.`);
    else seen.set(header, field.label);
  }
  return problems;
}
