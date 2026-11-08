import { BLANK_VALUE, featureOn, inferFilterKind, type FilterKind } from "@workspace/shared";
import type { ColumnSpec } from "./types";

/**
 * The filter a column offers (spec A2), or null when it has none: visual columns, opted-out
 * ones, and every column while the shell.tables switch is off.
 */
export function filterKindOf<T>(spec: ColumnSpec<T>, rows: readonly T[]): FilterKind | null {
  if (!featureOn("shell.tables") || spec.visualOnly || spec.filter === false) return null;
  return spec.filter ?? inferFilterKind(rows.map(spec.value), !!spec.kind);
}

/** The values a multi-select offers: every value in the column, alphabetical, blanks last. */
export function optionsOf<T>(spec: ColumnSpec<T>, rows: readonly T[]): string[] {
  const values = new Set(rows.map((r) => spec.value(r)).map((v) => (v === null ? BLANK_VALUE : String(v))));
  return [...values].sort((a, b) => (a === BLANK_VALUE ? 1 : b === BLANK_VALUE ? -1 : a.localeCompare(b)));
}
