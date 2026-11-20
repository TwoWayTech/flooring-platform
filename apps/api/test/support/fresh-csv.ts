import { readFileSync } from "node:fs";
import { importKind, type ImportKind, type ImportRequest } from "@workspace/shared";

/**
 * Sample CSV files for the whole-product check's fresh company (FS), read as the Import screen
 * sends them (ADR 0057 S-15): the file's own headers and rows, and a mapping that names each
 * column by the kind's field whose label it carries. The web parses files with SheetJS in a worker,
 * which the API tests can't load, so this reads the plain RFC 4180 subset the sample files use.
 */

/** The sample files' folder: invented companies, people and products only (CLAUDE.md rule 14). */
export const SAMPLE_DIR = new URL("../fixtures/fresh-company/", import.meta.url);

/**
 * The rows of a CSV text, each a list of cells: commas separate cells, a cell in double quotes may
 * hold commas and doubled quotes, and a final newline is optional. A quote left open, or a row
 * with a different number of cells than the header, is a mistake in the sample, so it throws.
 */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("A quoted cell is never closed.");
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  const width = rows[0]?.length ?? 0;
  const ragged = rows.findIndex((cells) => cells.length !== width);
  if (ragged >= 0) throw new Error(`Line ${ragged + 1} has ${rows[ragged]?.length} cells, the header ${width}.`);
  return rows;
}

/**
 * A sample file as an import request of its kind: every header must be the label of one of the
 * kind's fields, so a typo in a sample fails here rather than as a silently unmapped column.
 */
export function sampleImport(kind: ImportKind, fileName: string): ImportRequest {
  const [headers = [], ...rows] = csvRows(readFileSync(new URL(fileName, SAMPLE_DIR), "utf8"));
  const byLabel = new Map(importKind(kind).fields.map((field) => [field.label, field.key]));
  const unknown = headers.filter((header) => !byLabel.has(header));
  if (unknown.length > 0) throw new Error(`${fileName}: no ${kind} field is labelled ${unknown.join(", ")}.`);
  return {
    kind,
    fileName,
    table: { headers, rows },
    mapping: Object.fromEntries(headers.map((header) => [byLabel.get(header) as string, header])),
  };
}
