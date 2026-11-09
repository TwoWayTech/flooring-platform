/// <reference lib="webworker" />
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { MAX_IMPORT_BYTES, type ImportTable } from "@workspace/shared";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Headers as the file has them, trimmed; a blank header becomes "Column 3" and a repeated one
 * gets a number, so every column can be told apart in the mapping step.
 */
function headersOf(row: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((cell, i) => {
    const base = cell.trim() || `Column ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

/** The header row and the data rows, every cell as text, each row as wide as the header. */
function toTable(grid: readonly unknown[][]): ImportTable {
  const [first, ...rest] = grid.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );
  if (!first || rest.length === 0) throw new Error("The file has no rows under the header row.");
  const headers = headersOf(first);
  return { headers, rows: rest.map((row) => headers.map((_, i) => row[i] ?? "")) };
}

/** Reads a CSV with Papa Parse or the first sheet of a workbook with SheetJS (spec G1 step 3). */
async function parse(file: File): Promise<WorkerResponse> {
  if (file.size > MAX_IMPORT_BYTES)
    throw new Error("The file is larger than 10 MB, the demo limit. Split it and import the parts.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" });
    return { ok: true, type: "parse", table: toTable(parsed.data), sheet: null };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = book.SheetNames[0];
    if (!sheet) throw new Error("The workbook has no sheets.");
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet]!, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
      dateNF: "yyyy-mm-dd",
    });
    return { ok: true, type: "parse", table: toTable(grid), sheet };
  }
  throw new Error("Choose a CSV or Excel file (.csv, .xlsx or .xls).");
}

/** Writes a table as CSV (with a byte-order mark so Excel reads it as UTF-8) or as an Excel workbook. */
function write(table: string[][], format: "csv" | "xlsx", sheet: string): WorkerResponse {
  if (format === "csv") {
    return { ok: true, type: "write", blob: new Blob(["﻿", Papa.unparse(table)], { type: "text/csv;charset=utf-8" }) };
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(table), sheet.slice(0, 31));
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return { ok: true, type: "write", blob: new Blob([bytes], { type: XLSX_TYPE }) };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const response =
      request.type === "parse" ? await parse(request.file) : write(request.table, request.format, request.sheet);
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The file could not be read.",
    } satisfies WorkerResponse);
  }
};
