import { mappingProblems } from "./mapping";
import { MAX_IMPORT_ROWS } from "./plan";
import type { ColumnMapping, ImportKindDef, ImportRequest, ImportTable } from "./types";

/**
 * The size of one import (ADR 0057 S-12): rows and columns of the file, the characters of a cell,
 * a header and the file name, and the API's JSON body limit (body-parser's default, unchanged).
 * The demo keeps its own 10 MB file limit as well.
 */
export const IMPORT_LIMITS = {
  rows: MAX_IMPORT_ROWS,
  columns: 60,
  cellChars: 1000,
  headerChars: 200,
  fileNameChars: 200,
  requestBytes: 100_000,
} as const;

/** What the web says when the chosen columns of a file are over the API's body limit (ADR 0057 S-12). */
export const IMPORT_TOO_LARGE =
  "This file is too large to send in one go. Split it into smaller files and import them one by one.";

/** The headers the mapping chooses, in field order, each once. */
function mappedHeaders(def: ImportKindDef, mapping: ColumnMapping): string[] {
  return [...new Set(def.fields.map((f) => mapping[f.key]).filter((h): h is string => !!h))];
}

/**
 * What stops a request from being checked or imported, or null (spec rule 4; ADR 0057 S-12),
 * the first of: a mapping problem, a chosen header that is not in the file, more rows than one
 * import takes, or a chosen cell over 1,000 characters. Unchosen cells are never read.
 */
export function importRequestProblem(def: ImportKindDef, request: ImportRequest): string | null {
  const first = mappingProblems(def, request.mapping)[0];
  if (first) return first;
  const { headers, rows } = request.table;
  const headersUsed = mappedHeaders(def, request.mapping);
  const missing = headersUsed.find((h) => !headers.includes(h));
  if (missing !== undefined) return `“${missing}” is not a column of this file.`;
  if (rows.length > IMPORT_LIMITS.rows) {
    return `This file has ${rows.length} rows. Import up to 2,000 at a time; split the file.`;
  }
  const index = new Map(headers.map((h, i) => [h, i]));
  for (const [i, cells] of rows.entries()) {
    const long = headersUsed.find((h) => (cells[index.get(h)!] ?? "").length > IMPORT_LIMITS.cellChars);
    if (long !== undefined) {
      return `Row ${i + 2}: a cell under “${long}” is longer than 1,000 characters. Shorten it or leave that column out.`;
    }
  }
  return null;
}

/**
 * The mapping a request's column choices give for a kind (ADR 0057 S-17): each of the kind's
 * fields with its header or null. A choice naming any other field, `__proto__` included, is
 * refused; only own properties are read, so nothing reaches a prototype.
 */
export function mappingFor(
  def: ImportKindDef,
  raw: Readonly<Record<string, string | null>>,
): ColumnMapping | { problem: string } {
  const known = new Set(def.fields.map((f) => f.key));
  if (Object.keys(raw).some((key) => !known.has(key))) {
    return { problem: "The column choices name a field this import doesn't have." };
  }
  return Object.fromEntries(def.fields.map((f) => [f.key, (Object.hasOwn(raw, f.key) && raw[f.key]) || null]));
}

/**
 * The request's table with only the chosen columns, in field order, and every row kept so line
 * numbers stay (ADR 0057 S-15): what the web sends, so no unchosen cell leaves the browser. A
 * short row reads as empty cells.
 */
export function mappedTable(def: ImportKindDef, request: ImportRequest): ImportTable {
  const headers = mappedHeaders(def, request.mapping);
  const index = new Map(request.table.headers.map((h, i) => [h, i]));
  const at = headers.map((h) => index.get(h));
  return {
    headers,
    rows: request.table.rows.map((cells) => at.map((i) => (i === undefined ? "" : (cells[i] ?? "")))),
  };
}
