import type { ImportTable } from "@workspace/shared";

/** A file format the wizard writes: templates in CSV or Excel, the error report in CSV. */
export type TableFormat = "csv" | "xlsx";

/**
 * What the import worker is asked to do (spec G1: files are read and written off the main thread).
 * A write says whether CSV cells that start like a formula are escaped (`csvText`).
 */
export type WorkerRequest =
  | { type: "parse"; file: File }
  | { type: "write"; table: string[][]; format: TableFormat; sheet: string; escapeFormulas: boolean };

/** The worker's answer: a parsed table (with the sheet it came from), a written file, or a reason it failed. */
export type WorkerResponse =
  | { ok: true; type: "parse"; table: ImportTable; sheet: string | null }
  | { ok: true; type: "write"; blob: Blob }
  | { ok: false; error: string };
