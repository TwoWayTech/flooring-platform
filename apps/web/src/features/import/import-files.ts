import type { ImportTable } from "@workspace/shared";
import type { TableFormat, WorkerRequest, WorkerResponse } from "./worker-protocol";

/** Sends one request to a fresh worker and ends it with the answer, so nothing stays in memory. */
function ask(request: WorkerRequest): Promise<Extract<WorkerResponse, { ok: true }>> {
  const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The file could not be read."));
    };
    worker.postMessage(request);
  });
}

/** Reads an uploaded CSV or Excel file in a Web Worker (spec G1 step 3). */
export async function parseImportFile(file: File): Promise<{ table: ImportTable; sheet: string | null }> {
  const answer = await ask({ type: "parse", file });
  if (answer.type !== "parse") throw new Error("The file could not be read.");
  return { table: answer.table, sheet: answer.sheet };
}

/** Writes a table in a Web Worker, CSV cells escaped or not. */
async function writeFile(
  table: string[][],
  format: TableFormat,
  sheet: string,
  escapeFormulas: boolean,
): Promise<Blob> {
  const answer = await ask({ type: "write", table, format, sheet, escapeFormulas });
  if (answer.type !== "write") throw new Error("The file could not be written.");
  return answer.blob;
}

/**
 * Writes a table as a CSV or Excel file in a Web Worker, cells as they are: HR's timesheet
 * templates and the pay-period export, which payroll software reads. Escaping their formula
 * cells waits for the app-wide CSV rule (ADR 0057 S14, owner question 11).
 */
export async function writeTableFile(table: string[][], format: TableFormat, sheet: string): Promise<Blob> {
  return writeFile(table, format, sheet, false);
}

/**
 * Writes one of the import wizard's own files in a Web Worker: a template or the error report.
 * A CSV cell that starts like a formula gets a leading `'` (ADR 0057 S-15), because the error
 * report repeats what the uploaded file held.
 */
export async function writeImportFile(table: string[][], format: TableFormat, sheet: string): Promise<Blob> {
  return writeFile(table, format, sheet, true);
}
