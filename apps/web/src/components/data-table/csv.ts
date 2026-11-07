import type { ColumnSpec } from "./types";

function escape(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text of the given rows and columns. Values are the stored ones, so exports keep full precision. */
export function toCsv<T>(rows: readonly T[], columns: readonly ColumnSpec<T>[]): string {
  const exported = columns.filter((c) => !c.visualOnly);
  const header = exported.map((c) => escape(c.header)).join(",");
  const lines = rows.map((row) => exported.map((c) => escape(c.value(row))).join(","));
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
