"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import type { ImportTable } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { ScrollRegion } from "@/components/scroll-region";
import { parseImportFile } from "@/features/import/import-files";
import { api } from "@/lib/api";
import type { TimesheetUploadResult } from "@/lib/api/contract";

/**
 * Bulk hours from the template (spec C1, C2): choose a file, see what each row would do with its
 * errors, then save the good rows. `own` limits it to the signed-in person's rows.
 */
export function TimesheetUploadDialog({ own, onClose }: { own: boolean; onClose: () => void }) {
  const [file, setFile] = useState<{ table: ImportTable; name: string } | null>(null);
  const [result, setResult] = useState<TimesheetUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    setError(null);
    try {
      const { table } = await parseImportFile(chosen);
      setFile({ table, name: chosen.name });
      setResult(await api.uploadTimesheets({ table, fileName: chosen.name, apply: false, own }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file could not be read.");
    }
  }

  async function save() {
    if (!file) return;
    try {
      const done = await api.uploadTimesheets({ table: file.table, fileName: file.name, apply: true, own });
      toast.success(`${done.counts.create + done.counts.update} days of hours saved`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "These hours could not be saved.");
    }
  }

  const errors = result?.rows.filter((r) => r.action === "error") ?? [];
  const good = result ? result.counts.create + result.counts.update : 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload hours</DialogTitle>
          <DialogDescription>
            Use the template: one row per person per day. A blank leaves that day as it was.
          </DialogDescription>
        </DialogHeader>
        <label className="border-hairline hover:bg-raised flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-6 text-sm">
          <Upload aria-hidden="true" className="text-muted-foreground size-5" />
          <span>{file ? file.name : "Choose a CSV or Excel file"}</span>
          <input
            type="file"
            aria-label="Timesheet file"
            accept=".csv,.txt,.xlsx,.xls,text/csv"
            className="sr-only"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </label>
        {result ? (
          <p className="text-sm" role="status">
            {good} days to save, {result.counts.skip} left as they were, {result.counts.error} with errors.
          </p>
        ) : null}
        {errors.length > 0 ? (
          <ScrollRegion label="Rows with errors">
            <ul className="max-h-48 text-sm">
              {errors.map((row) => (
                <li key={row.line} className="border-hairline border-t py-1.5">
                  Row {row.line}: {row.problems.map((p) => p.message).join(" ")}
                </li>
              ))}
            </ul>
          </ScrollRegion>
        ) : null}
        {error ? (
          <p role="alert" className="text-danger-ink text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={good === 0} onClick={() => void save()}>
            Save hours
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
