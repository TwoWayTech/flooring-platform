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

/** Writes a table as a CSV or Excel file in a Web Worker: a template or the error report. */
export async function writeTableFile(table: string[][], format: TableFormat, sheet: string): Promise<Blob> {
  const answer = await ask({ type: "write", table, format, sheet });
  if (answer.type !== "write") throw new Error("The file could not be written.");
  return answer.blob;
}
