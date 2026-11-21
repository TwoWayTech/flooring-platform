"use client";

import { CircleCheck, Download } from "lucide-react";
import { toast } from "sonner";
import { errorTable, fixRowsTable, type ImportKindDef, type ImportTable } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import type { ImportResult } from "@/lib/api/contract";
import { saveBlob } from "@/lib/save-blob";
import { writeImportFile } from "./import-files";

/**
 * Step 5 (spec G1 step 7): the result report. Rows with errors were left out; the error report
 * lists each one with its row, column, value and problem, and the rows to fix are those rows in
 * the file's own columns with a Problems column, to correct and import again (click-through #52).
 */
export function DoneStep({ def, table, result }: { def: ImportKindDef; table: ImportTable; result: ImportResult }) {
  const { batch } = result;
  const { counts } = batch;

  async function download(rows: string[][], sheet: string, suffix: string) {
    try {
      saveBlob(await writeImportFile(rows, "csv", sheet), `${batch.number}-${suffix}.csv`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The file was not created.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck aria-hidden="true" className="text-success-ink size-5" />
        {batch.number} imported from {batch.fileName}
      </p>
      <p className="text-sm">
        <Num value={counts.create} kind="count" /> created, <Num value={counts.update} kind="count" /> updated,{" "}
        <Num value={counts.skip} kind="count" /> skipped.
      </p>
      {counts.error ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-danger-ink text-sm">
            <Num value={counts.error} kind="count" />{" "}
            {counts.error === 1 ? "row had errors and was" : "rows had errors and were"} left out. Download the rows to
            fix, correct them and import that file again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void download(fixRowsTable(def, table, result), "Rows to fix", "rows-to-fix")}
            >
              <Download />
              Download rows to fix
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void download(errorTable(def, result), "Errors", "errors")}
            >
              <Download />
              Download error report
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-muted-foreground text-sm">Something looks wrong? Undo the import from the history below.</p>
    </div>
  );
}
