import { momentIso } from "@workspace/shared";
import type { ColumnSpec } from "./types";

/** A cell a spreadsheet would run as a formula: it starts with =, +, -, @, a tab or a carriage return. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain number, such as a negative balance, which a spreadsheet reads as a number, not a formula. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell. Text a person typed (an account, customer or product name) that starts like a
 * formula gets a leading ' so a spreadsheet shows it instead of running it, as the import's CSV
 * does (ADR 0057 S-15); plain numbers stay as they are, so exports keep their values.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  const text = FORMULA_START.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV text of the given rows and columns. Values are the stored ones, so exports keep full precision.
 * With `zone`, a moment is written as ISO 8601 with that zone's offset, "2026-11-21T07:56:00-07:00",
 * so a spreadsheet keeps the exact instant and reads the company's clock (ADR 0064); calendar dates
 * and every other value stay as they are.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly ColumnSpec<T>[], zone?: string): string {
  const exported = columns.filter((c) => !c.visualOnly);
  const header = exported.map((c) => csvCell(c.header)).join(",");
  const cell = (value: string | number | null) =>
    csvCell(zone && typeof value === "string" ? momentIso(value, zone) : value);
  const lines = rows.map((row) => exported.map((c) => cell(c.value(row))).join(","));
  return [header, ...lines].join("\n");
}

/** Saves text as a file through the browser's download (a real export, spec "Reports hub"). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
