"use client";

import { CircleCheck, Download } from "lucide-react";
import { toast } from "sonner";
import { errorTable, type ImportKindDef } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import type { ImportResult } from "@/lib/api/contract";
import { saveBlob } from "@/lib/save-blob";
import { writeTableFile } from "./import-files";

/**
 * Step 5 (spec G1 step 7): the result report. Rows with errors were left out; the error report
 * lists each one with its row, column, value and problem, to fix in the file and import again.
 */
export function DoneStep({ def, result }: { def: ImportKindDef; result: ImportResult }) {
  const { batch } = result;
  const { counts } = batch;

  async function downloadErrors() {
    try {
      const blob = await writeTableFile(errorTable(def, result), "csv", "Errors");
      saveBlob(blob, `${batch.number}-errors.csv`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The error report was not created.");
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
            {counts.error === 1 ? "row had errors and was" : "rows had errors and were"} left out. Download the error
            report, fix those rows and import the file again.
          </p>
          <Button variant="outline" size="sm" onClick={() => void downloadErrors()}>
            <Download />
            Download error report
          </Button>
        </div>
      ) : null}
      <p className="text-muted-foreground text-sm">Something looks wrong? Undo the import from the history below.</p>
    </div>
  );
}
